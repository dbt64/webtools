<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowUpRight, Command, CornerDownLeft, Globe, Search } from '@lucide/vue'
import type { AppSearchEntry } from '@/shared/domain'
import { buildSearchIndex } from '@/shared/pinyin-index'
import { searchEntries, type SearchableEntry } from '@/shared/search'
import { parseSearchCommand } from '@/shared/search-command'

const query = ref('')
const apps = ref<AppSearchEntry[]>([])
const selectedIndex = ref(0)
const input = ref<HTMLInputElement>()
const error = ref('')
const parsed = computed(() => parseSearchCommand(query.value))
const isWeb = computed(() => parsed.value.mode === 'web')
const entries = computed<SearchableEntry[]>(() => apps.value.map((app) => ({ id: app.id, name: app.name, aliases: app.aliases, kind: 'app', subtitle: '本地应用' })))
const index = computed(() => buildSearchIndex(entries.value))
const results = computed(() => isWeb.value ? [] : searchEntries(parsed.value.query, entries.value, index.value).slice(0, 8))

async function focus(): Promise<void> {
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

async function load(): Promise<void> {
  try { apps.value = await window.desktop.getApps() } catch { apps.value = [] }
}

async function hide(): Promise<void> {
  query.value = ''
  error.value = ''
  await window.desktop.setLauncherExpanded(false)
  await window.desktop.hideLauncher()
}

async function openManager(): Promise<void> {
  await window.desktop.showManager()
  await hide()
}

async function submit(): Promise<void> {
  if (isWeb.value) {
    if (!parsed.value.query) return
    const result = await window.desktop.openSearch(parsed.value.query)
    if (!result.ok) { error.value = result.error.message; return }
    await hide()
    return
  }
  const item = results.value[selectedIndex.value]
  if (!item) return
  const result = await window.desktop.launchApp(item.entry.id)
  if (!result.ok) { error.value = result.error.message; return }
  await hide()
}

function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); void hide() }
  else if (event.key === 'ArrowDown' && results.value.length) { event.preventDefault(); selectedIndex.value = (selectedIndex.value + 1) % results.value.length }
  else if (event.key === 'ArrowUp' && results.value.length) { event.preventDefault(); selectedIndex.value = (selectedIndex.value - 1 + results.value.length) % results.value.length }
  else if (event.key === 'Enter') { event.preventDefault(); void submit() }
}

watch(query, (value) => {
  selectedIndex.value = 0
  error.value = ''
  void window.desktop.setLauncherExpanded(Boolean(value.trim()))
})

onMounted(() => {
  void load()
  void focus()
  window.addEventListener('webtools-launcher-show', () => { query.value = ''; error.value = ''; void focus() })
})
</script>

<template>
  <main class="launcher-shell">
    <div class="launcher-bar">
      <Search class="launcher-search-icon" :size="20" />
      <input ref="input" v-model="query" placeholder="搜索应用，输入 ? 搜索网页" autocomplete="off" spellcheck="false" @keydown="keydown" />
      <button class="launcher-brand" aria-label="打开 WebTools 管理界面" title="打开 WebTools" @mousedown.prevent @click="openManager">
        <Command :size="19" :stroke-width="2.4" />
      </button>
    </div>
    <section v-if="query.trim()" class="launcher-results">
      <div v-if="isWeb" class="launcher-hint"><Globe :size="16" /><span>{{ parsed.query ? `使用默认搜索引擎搜索“${parsed.query}”` : '输入关键词后按 Enter 搜索网页' }}</span><kbd>Enter ↵</kbd></div>
      <template v-else>
        <button v-for="(result, idx) in results" :key="result.entry.id" class="launcher-result" :class="{ selected: selectedIndex === idx }" @mousedown.prevent @mouseenter="selectedIndex = idx" @click="submit">
          <span class="launcher-result-icon"><Command :size="17" /></span>
          <span class="launcher-result-copy"><strong>{{ result.entry.name }}</strong><small>{{ result.entry.subtitle }}</small></span>
          <span class="launcher-result-match" v-if="result.match !== 'name'">{{ result.match === 'pinyin' ? '拼音' : result.match === 'alias' ? '别名' : '首字母' }}</span>
          <CornerDownLeft v-if="selectedIndex === idx" :size="15" class="launcher-enter-icon" />
        </button>
        <div v-if="!results.length" class="launcher-empty">没有找到匹配的应用</div>
      </template>
      <p v-if="error" class="launcher-error">{{ error }}</p>
    </section>
    <footer v-if="query.trim()" class="launcher-foot"><span>↑↓ 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span><span class="launcher-foot-spacer"></span><span><ArrowUpRight :size="12" /> WebTools</span></footer>
  </main>
</template>
