<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowUpRight, BookmarkPlus, Command, CornerDownLeft, File, Folder, Globe, Search } from '@lucide/vue'
import type { AppSearchEntry, BookmarkFolder, WebsiteEntry, EverythingResult } from '@/shared/domain'
import { buildSearchIndex } from '@/shared/pinyin-index'
import { searchEntries, type SearchableEntry } from '@/shared/search'
import { parseSearchCommand } from '@/shared/search-command'
import BookmarkDialog from '../bookmarks/BookmarkDialog.vue'
import Favicon from '../bookmarks/Favicon.vue'

interface LauncherEntry extends SearchableEntry { favicon?: string; url?: string }
const query = ref('')
const apps = ref<AppSearchEntry[]>([])
const websites = ref<WebsiteEntry[]>([])
const folders = ref<BookmarkFolder[]>([])
const selectedIndex = ref(0)
const input = ref<HTMLInputElement>()
const error = ref('')
const fileResults = ref<EverythingResult[]>([])
const fileStatus = ref('')
let fileSearchSequence = 0
const bookmarkTarget = ref<LauncherEntry>()
const showBookmarkDialog = ref(false)
const savingBookmark = ref(false)
const parsed = computed(() => parseSearchCommand(query.value))
const isWeb = computed(() => parsed.value.mode === 'web')
const isFiles = computed(() => parsed.value.mode === 'files')
const entries = computed<LauncherEntry[]>(() => [
  ...apps.value.map((app) => ({ id: app.id, name: app.name, aliases: app.aliases, kind: 'app' as const, subtitle: '本地应用' })),
  ...websites.value.map((site) => ({ id: site.id, name: site.name, kind: 'website' as const, subtitle: site.url, url: site.url, favicon: site.favicon, folderIds: site.folderIds, searchText: site.description ?? '' })),
])
const index = computed(() => buildSearchIndex(entries.value))
const results = computed(() => parsed.value.mode !== 'local' ? [] : searchEntries(parsed.value.query, entries.value, index.value).slice(0, 8))
const selectableCount = computed(() => isFiles.value ? fileResults.value.length : results.value.length)

async function focus(): Promise<void> {
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

async function load(): Promise<void> {
  try { [apps.value, websites.value] = await Promise.all([window.desktop.getApps(), window.desktop.listWebsites()]) } catch { apps.value = []; websites.value = [] }
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
  if (isFiles.value) {
    const item = fileResults.value[selectedIndex.value]
    if (!item) return
    const result = await window.desktop.openEverythingResult(item.id)
    if (!result.ok) { error.value = result.error.message; return }
    await hide()
    return
  }
  const item = results.value[selectedIndex.value]
  if (!item) return
  const result = item.entry.kind === 'app' ? await window.desktop.launchApp(item.entry.id) : await window.desktop.openWebsite(item.entry.id)
  if (!result.ok) { error.value = result.error.message; return }
  await hide()
}

async function promptBookmark(entry: LauncherEntry): Promise<void> {
  bookmarkTarget.value = entry
  folders.value = await window.desktop.listBookmarkFolders()
  showBookmarkDialog.value = true
}

async function saveBookmark(input: { folderId?: string; newFolderName?: string }): Promise<void> {
  savingBookmark.value = true
  try {
    let folderId = input.folderId
    if (input.newFolderName) {
      const result = await window.desktop.saveBookmarkFolder({ name: input.newFolderName })
      if (!result.ok) { error.value = result.error.message; return }
      folderId = result.data.id
    }
    if (!folderId) return
    const result = await window.desktop.addWebsiteToFolders(bookmarkTarget.value!.id, [...new Set([...(bookmarkTarget.value?.folderIds ?? []), folderId])])
    if (!result.ok) { error.value = result.error.message; return }
    websites.value = await window.desktop.listWebsites()
    showBookmarkDialog.value = false
  } finally { savingBookmark.value = false }
}

function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); void hide() }
  else if (event.key === 'ArrowDown' && selectableCount.value) { event.preventDefault(); selectedIndex.value = (selectedIndex.value + 1) % selectableCount.value }
  else if (event.key === 'ArrowUp' && selectableCount.value) { event.preventDefault(); selectedIndex.value = (selectedIndex.value - 1 + selectableCount.value) % selectableCount.value }
  else if (event.key === 'Enter') { event.preventDefault(); void submit() }
}

watch(query, (value) => {
  selectedIndex.value = 0
  error.value = ''
  void window.desktop.setLauncherExpanded(Boolean(value.trim()))
  const sequence = ++fileSearchSequence
  const command = parseSearchCommand(value)
  fileResults.value = []
  fileStatus.value = ''
  if (command.mode === 'files' && command.query) {
    fileStatus.value = '正在搜索 Everything…'
    window.setTimeout(async () => {
      if (sequence !== fileSearchSequence) return
      const result = await window.desktop.searchEverything(command.query)
      if (sequence !== fileSearchSequence) return
      if (result.ok) { fileResults.value = result.data; fileStatus.value = result.data.length ? '' : '没有找到匹配的文件或文件夹。' }
      else fileStatus.value = result.error.message
    }, 160)
  } else if (command.mode === 'files') fileStatus.value = '输入关键词搜索文件和文件夹。'
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
      <template v-else-if="isFiles">
        <button v-for="(result, idx) in fileResults.slice(0, 8)" :key="result.id" class="launcher-result" :class="{ selected: selectedIndex === idx }" @mousedown.prevent @mouseenter="selectedIndex = idx" @click="submit">
          <span class="launcher-result-icon file-result-icon"><Folder v-if="result.kind === 'folder'" :size="17" /><File v-else :size="17" /></span>
          <span class="launcher-result-copy"><strong>{{ result.name }}</strong><small>{{ result.locationLabel }}</small></span>
          <CornerDownLeft v-if="selectedIndex === idx" :size="15" class="launcher-enter-icon" />
        </button>
        <div v-if="fileStatus" class="launcher-empty">{{ fileStatus }}</div>
      </template>
      <template v-else>
        <div v-for="(result, idx) in results" :key="result.entry.id" class="launcher-result-wrap">
        <button class="launcher-result" :class="{ selected: selectedIndex === idx }" @mousedown.prevent @mouseenter="selectedIndex = idx" @click="submit">
          <span class="launcher-result-icon"><Favicon v-if="result.entry.kind === 'website'" :url="result.entry.url ?? ''" :favicon="result.entry.favicon" /><Command v-else :size="17" /></span>
          <span class="launcher-result-copy"><strong>{{ result.entry.name }}</strong><small>{{ result.entry.subtitle }}</small></span>
          <span class="launcher-result-match" v-if="result.match !== 'name'">{{ result.match === 'pinyin' ? '拼音' : result.match === 'alias' ? '别名' : '首字母' }}</span>
          <CornerDownLeft v-if="selectedIndex === idx" :size="15" class="launcher-enter-icon" />
        </button>
        <button v-if="result.entry.kind === 'website'" class="launcher-add" title="添加到收藏夹" @mousedown.prevent @click="promptBookmark(result.entry)"><BookmarkPlus :size="16" /></button>
        </div>
        <div v-if="!results.length" class="launcher-empty">没有找到匹配的应用</div>
      </template>
      <p v-if="error" class="launcher-error">{{ error }}</p>
    </section>
    <footer v-if="query.trim()" class="launcher-foot"><span>↑↓ 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span><span class="launcher-foot-spacer"></span><span><ArrowUpRight :size="12" /> WebTools</span></footer>
    <BookmarkDialog v-if="showBookmarkDialog && bookmarkTarget" :folders="folders" :website-name="bookmarkTarget.name" :saving="savingBookmark" @save="saveBookmark" @cancel="showBookmarkDialog = false" />
  </main>
</template>
