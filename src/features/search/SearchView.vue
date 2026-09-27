<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  Bookmark, Check, ChevronDown, Command, CornerDownLeft, File, Folder, Languages, Plus, Search, Sparkles, SquareArrowOutUpRight,
} from '@lucide/vue'
import { createDefaultAppData, type AppSearchEntry, type AppSettings, type SearchEngine, type WebsiteEntry, type EverythingResult } from '@/shared/domain'
import { buildSearchIndex } from '@/shared/pinyin-index'
import { searchEntries, type SearchableEntry, type SearchResult as SearchResultItem } from '@/shared/search'
import { parseManagerSearchCommand } from '@/shared/search-command'
import SearchResult from './SearchResult.vue'
import BookmarkDialog from '../bookmarks/BookmarkDialog.vue'
import type { BookmarkFolder } from '@/shared/domain'

const emit = defineEmits<{ navigate: [section: 'entries' | 'translate' | 'settings'] }>()

const apps = ref<AppSearchEntry[]>([])
const webEntries = ref<WebsiteEntry[]>([])
const settings = ref<AppSettings>(createDefaultAppData().settings)
const query = ref('')
const selectedIndex = ref(0)
const searchInput = ref<HTMLInputElement>()
const enginePicker = ref<HTMLElement>()
const engineTrigger = ref<HTMLButtonElement>()
const settingsReady = ref(false)
const settingsLoadError = ref('')
const enginePickerOpen = ref(false)
const enginePickerIndex = ref(0)
const enginePickerSaving = ref(false)
const enginePickerError = ref('')
const bookmarkFolders = ref<BookmarkFolder[]>([])
const bookmarkTarget = ref<SearchableEntry>()
const showBookmarkDialog = ref(false)
const savingBookmark = ref(false)
const refreshing = ref(false)
const fileResults = ref<EverythingResult[]>([])
const fileStatus = ref('')
let fileSearchSequence = 0
const parsed = computed(() => parseManagerSearchCommand(query.value))
const isWebSearch = computed(() => parsed.value.mode === 'web')
const isFileSearch = computed(() => parsed.value.mode === 'files')
const enabledEngines = computed(() => settings.value.searchEngines.filter((engine) => engine.enabled).sort((a, b) => a.order - b.order))
const selectedEngine = computed(() => enabledEngines.value.find((engine) => engine.id === settings.value.defaultSearchEngineId) ?? enabledEngines.value[0])
const defaultEngineName = computed(() => selectedEngine.value?.name ?? '默认搜索引擎')
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' })
function engineMark(engine: SearchEngine): string {
  if (engine.id === 'google') return 'G'
  if (engine.id === 'baidu') return '百'
  if (engine.id === 'bilibili') return 'B'
  return segmenter.segment(engine.name.trim())[Symbol.iterator]().next().value?.segment?.toLocaleUpperCase() ?? '?'
}

async function openEnginePicker(): Promise<void> {
  if (!settingsReady.value) return
  enginePickerError.value = ''
  enginePickerIndex.value = Math.max(0, enabledEngines.value.findIndex((engine) => engine.id === selectedEngine.value?.id))
  enginePickerOpen.value = true
  await nextTick()
  focusEngineOption(enginePickerIndex.value)
}

function focusEngineOption(index: number): void {
  enginePicker.value?.querySelectorAll<HTMLButtonElement>('.engine-option')[index]?.focus()
}

function closeEnginePicker(restoreFocus = false): void {
  enginePickerOpen.value = false
  if (restoreFocus) nextTick(() => engineTrigger.value?.focus())
}

function handleEnginePickerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeEnginePicker(true)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const count = enabledEngines.value.length
    if (!count) return
    enginePickerIndex.value = (enginePickerIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
    focusEngineOption(enginePickerIndex.value)
  }
}

async function chooseEngine(engine: SearchEngine): Promise<void> {
  if (enginePickerSaving.value) return
  enginePickerSaving.value = true
  enginePickerError.value = ''
  try {
    const result = await window.desktop.updateSettings({ defaultSearchEngineId: engine.id })
    if (!result.ok) { enginePickerError.value = result.error.message; return }
    settings.value = result.data
    settingsLoadError.value = ''
    closeEnginePicker(true)
  } catch {
    enginePickerError.value = '无法保存默认搜索引擎，请重试。'
  } finally {
    enginePickerSaving.value = false
  }
}

function handleOutsidePointer(event: PointerEvent): void {
  if (enginePickerOpen.value && !enginePicker.value?.contains(event.target as Node)) closeEnginePicker()
}
const searchableEntries = computed<SearchableEntry[]>(() => [
  ...apps.value.map((entry) => ({ id: entry.id, name: entry.name, aliases: entry.aliases, kind: 'app' as const, subtitle: '本地应用' })),
  ...webEntries.value.map((entry) => ({ id: entry.id, name: entry.name, kind: 'website' as const, subtitle: entry.url, url: entry.url, folderIds: entry.folderIds, searchText: `${entry.url} ${entry.description ?? ''}` })),
])
const index = computed(() => buildSearchIndex(searchableEntries.value))
const results = computed(() => parsed.value.mode !== 'local' ? [] : searchEntries(parsed.value.query, searchableEntries.value, index.value))
const selectableCount = computed(() => isFileSearch.value ? fileResults.value.length : results.value.length)
const resultGroups = computed(() => [
  { kind: 'app' as const, label: '应用', items: results.value.filter((result) => result.entry.kind === 'app') },
  { kind: 'website' as const, label: '网址', items: results.value.filter((result) => result.entry.kind === 'website') },
].filter((group) => group.items.length))

async function loadApps(refresh = false): Promise<void> {
  refreshing.value = refresh
  try {
    if (!refresh) {
      try {
        settings.value = await window.desktop.getSettings()
        settingsLoadError.value = ''
      } catch {
        settingsLoadError.value = '无法加载搜索引擎设置，当前使用默认选项。'
      } finally {
        settingsReady.value = true
      }
    }
    const [loadedApps, entries] = await Promise.all([
      refresh ? window.desktop.refreshApps() : window.desktop.getApps(),
      window.desktop.listWebsites(),
    ])
    apps.value = loadedApps
    webEntries.value = entries
  } catch {
    // Show an empty result state while keeping the search box usable.
  } finally {
    refreshing.value = false
  }
}

async function launchSelected(): Promise<void> {
  const selected = results.value[selectedIndex.value]
  if (isFileSearch.value) {
    const file = fileResults.value[selectedIndex.value]
    if (!file) return
    const result = await window.desktop.openEverythingResult(file.id)
    if (!result.ok) window.alert(result.error.message)
    return
  }
  if (isWebSearch.value) {
    if (!parsed.value.query) return
    const result = await window.desktop.openSearch(parsed.value.query)
    if (!result.ok) window.alert(result.error.message)
    return
  }
  if (!selected) return
  const result = selected.entry.kind === 'app'
    ? await window.desktop.launchApp(selected.entry.id)
    : await window.desktop.openWebsite(selected.entry.id)
  if (!result.ok) window.alert(result.error.message)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' && selectableCount.value) {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % selectableCount.value
  } else if (event.key === 'ArrowUp' && selectableCount.value) {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + selectableCount.value) % selectableCount.value
  } else if (event.key === 'Enter' && isWebSearch.value && parsed.value.query) {
    event.preventDefault()
    void launchSelected()
  } else if (event.key === 'Enter' && selectableCount.value) {
    event.preventDefault()
    void launchSelected()
  } else if (event.key === 'Escape') {
    query.value = ''
    selectedIndex.value = 0
  }
}

async function addSearchResultBookmark(result: SearchResultItem<SearchableEntry>): Promise<void> {
  const loaded = await window.desktop.listBookmarkFolders()
  bookmarkFolders.value = loaded
  bookmarkTarget.value = result.entry
  showBookmarkDialog.value = true
}

function resultIndex(result: SearchResultItem): number {
  return results.value.findIndex((item) => item.entry.kind === result.entry.kind && item.entry.id === result.entry.id)
}

async function saveBookmark(input: { folderId?: string; newFolderName?: string }): Promise<void> {
  savingBookmark.value = true
  try {
    let folderId = input.folderId
    if (input.newFolderName) {
      const folder = await window.desktop.saveBookmarkFolder({ name: input.newFolderName })
      if (!folder.ok) { window.alert(folder.error.message); return }
      folderId = folder.data.id
    }
    if (!folderId) return
    const result = await window.desktop.addWebsiteToFolders(bookmarkTarget.value!.id, [...new Set([...(bookmarkTarget.value?.folderIds ?? []), folderId])])
    if (!result.ok) { window.alert(result.error.message); return }
    showBookmarkDialog.value = false
  } finally {
    savingBookmark.value = false
  }
}

watch(query, (value) => {
  selectedIndex.value = 0
  const sequence = ++fileSearchSequence
  const command = parseManagerSearchCommand(value)
  fileResults.value = []
  fileStatus.value = ''
  if (command.mode !== 'files') return
  fileStatus.value = command.query ? '正在搜索 Everything…' : '输入 file: 和关键词搜索文件。'
  if (!command.query) return
  window.setTimeout(async () => {
    if (sequence !== fileSearchSequence) return
    const result = await window.desktop.searchEverything(command.query)
    if (sequence !== fileSearchSequence) return
    if (result.ok) { fileResults.value = result.data; fileStatus.value = result.data.length ? '' : '没有找到匹配的文件或文件夹。' }
    else fileStatus.value = result.error.message
  }, 160)
})
onMounted(() => {
  void loadApps()
  searchInput.value?.focus()
  document.addEventListener('pointerdown', handleOutsidePointer)
})
onUnmounted(() => document.removeEventListener('pointerdown', handleOutsidePointer))
</script>

<template>
  <section class="search-page">
    <div class="welcome-block">
      <div class="welcome-icon"><Sparkles :size="17" /></div>
      <p class="eyebrow">一处开始，随手可达</p>
      <h1>接下来要做什么？</h1>
      <p class="welcome-copy">搜索应用、打开常用网址，或者用 <kbd>?</kbd> 开始网页搜索。</p>
    </div>

    <div ref="enginePicker" class="search-input-wrap">
      <div class="search-box">
        <button
          ref="engineTrigger"
          type="button"
          class="engine-trigger"
          :aria-label="`选择搜索引擎，当前为${defaultEngineName}`"
          aria-haspopup="listbox"
          :aria-expanded="enginePickerOpen"
          :disabled="!settingsReady"
          @click="enginePickerOpen ? closeEnginePicker() : openEnginePicker()"
          @keydown.esc.prevent="closeEnginePicker(true)"
        >
          <span class="engine-mark">{{ selectedEngine ? engineMark(selectedEngine) : '?' }}</span>
          <ChevronDown :size="13" aria-hidden="true" />
        </button>
        <input
          id="quick-search"
          ref="searchInput"
          v-model="query"
          aria-label="搜索应用或网址"
          autocomplete="off"
          placeholder="搜索应用或网址…"
          spellcheck="false"
          @keydown="handleKeydown"
        />
      </div>
      <div v-if="enginePickerOpen" class="engine-picker-panel" @keydown="handleEnginePickerKeydown">
        <div class="engine-picker-list" role="listbox" aria-label="选择搜索引擎">
          <button
            v-for="(engine, index) in enabledEngines"
            :key="engine.id"
            type="button"
            class="engine-option"
            role="option"
            :aria-selected="engine.id === selectedEngine?.id"
            :disabled="enginePickerSaving"
            @focus="enginePickerIndex = index"
            @click="chooseEngine(engine)"
          >
            <span class="engine-option-mark">{{ engineMark(engine) }}</span>
            <span>{{ engine.name }}</span>
            <Check v-if="engine.id === selectedEngine?.id" :size="14" class="engine-option-check" aria-hidden="true" />
          </button>
        </div>
        <button type="button" class="engine-add-action" @click="closeEnginePicker(); emit('navigate', 'settings')"><Plus :size="15" aria-hidden="true" /> 添加搜索引擎</button>
        <p v-if="enginePickerError" class="engine-picker-error" role="alert">{{ enginePickerError }}</p>
      </div>
    </div>
    <p v-if="settingsLoadError" class="engine-load-error" role="alert">{{ settingsLoadError }}</p>

    <div v-if="query" class="search-feedback">
      <template v-if="isWebSearch">
        <span class="mode-chip"><Search :size="13" /> 网页搜索</span>
        <span>{{ defaultEngineName }} · {{ parsed.query ? `按 Enter 搜索“${parsed.query}”` : '请输入关键词' }}</span>
      </template>
      <template v-else-if="isFileSearch">
        <span class="mode-chip"><Folder :size="13" /> Everything 文件搜索</span>
        <span>{{ fileStatus || `${fileResults.length} 项 · 点击结果打开文件或文件夹` }}</span>
      </template>
      <template v-else>
        <span class="mode-chip"><Command :size="13" /> 本地搜索</span>
        <span>{{ results.length }} 项 · 应用支持拼音和首字母</span>
        <button class="refresh-button" :disabled="refreshing" title="重新扫描应用" @click="loadApps(true)">{{ refreshing ? '扫描中…' : '重新扫描' }}</button>
      </template>
    </div>

    <div v-if="query && isFileSearch" class="result-list" role="listbox" aria-label="Everything 文件搜索结果">
      <button v-for="(file, idx) in fileResults" :key="file.id" class="file-manager-result" :class="{ selected: selectedIndex === idx }" @mouseenter="selectedIndex = idx" @click="launchSelected"><span class="file-manager-icon"><Folder v-if="file.kind === 'folder'" :size="16" /><File v-else :size="16" /></span><span><strong>{{ file.name }}</strong><small>{{ file.locationLabel }}</small></span><CornerDownLeft v-if="selectedIndex === idx" :size="14" /></button>
      <div v-if="fileStatus" class="empty-results"><strong>{{ fileStatus }}</strong></div>
    </div>
    <div v-else-if="query && !isWebSearch && !isFileSearch" class="result-list" role="listbox" aria-label="应用搜索结果">
      <div v-for="group in resultGroups" :key="group.kind" class="result-group">
        <div class="result-group-heading"><span>{{ group.label }}</span><small>{{ group.items.length }}</small></div>
        <SearchResult
          v-for="result in group.items"
          :key="`${result.entry.kind}-${result.entry.id}`"
          :result="result"
          :selected="resultIndex(result) === selectedIndex"
          @select="launchSelected"
          @bookmark="addSearchResultBookmark(result)"
          @mouseenter="selectedIndex = resultIndex(result)"
        />
      </div>
      <div v-if="!results.length" class="empty-results">
        <span class="empty-orb"><Search :size="18" /></span>
        <strong>没有找到应用</strong>
        <span>试试应用名称、拼音，或拼音首字母</span>
      </div>
    </div>

    <div v-else-if="!query" class="quick-start">
      <div class="section-heading">
        <div><h2>快速开始</h2><p>常用动作，一键触达</p></div>
        <button class="text-button" @click="emit('navigate', 'entries')">管理入口 <SquareArrowOutUpRight :size="13" /></button>
      </div>
      <div class="quick-grid">
        <button class="quick-card" @click="emit('navigate', 'entries')">
          <span class="quick-card-icon bookmark-icon"><Bookmark :size="17" /></span>
          <span class="quick-card-text"><strong>管理网址</strong><small>整理常用网站和收藏夹</small></span>
          <span class="card-plus">+</span>
        </button>
        <button class="quick-card" @click="emit('navigate', 'translate')">
          <span class="quick-card-icon translate-icon"><Languages :size="17" /></span>
          <span class="quick-card-text"><strong>快速翻译</strong><small>AI 或 Google Translate</small></span>
          <span class="card-plus">+</span>
        </button>
      </div>
    </div>

    <footer class="search-footer">
      <span><i class="status-dot"></i> 本地优先</span>
      <span>搜索按键 <kbd>?</kbd> 可切换网页模式</span>
      <span>{{ apps.length }} 个本地应用</span>
    </footer>
    <BookmarkDialog
      v-if="showBookmarkDialog && bookmarkTarget?.kind === 'website'"
      :folders="bookmarkFolders"
      :website-name="bookmarkTarget.name"
      :saving="savingBookmark"
      @save="saveBookmark"
      @cancel="showBookmarkDialog = false"
    />
  </section>
</template>

<style scoped>
.search-input-wrap { position: relative; }
.engine-trigger { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 3px; padding: 3px; border: 0; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; }
.engine-trigger:hover, .engine-trigger:focus-visible { color: var(--text); background: var(--hover); outline: none; }
.engine-mark, .engine-option-mark { display: grid; width: 25px; height: 25px; flex: 0 0 auto; place-items: center; border: 1px solid var(--line); border-radius: 7px; color: var(--accent); background: var(--accent-soft); font-size: 14px; font-weight: 700; }
.engine-picker-panel { position: absolute; z-index: 10; top: calc(100% + 7px); left: 0; width: min(280px, 100%); overflow: hidden; padding: 5px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); box-shadow: 0 16px 35px #0007; }
.engine-picker-list { display: grid; max-height: 240px; gap: 2px; overflow-y: auto; }
.engine-option, .engine-add-action { display: flex; width: 100%; align-items: center; gap: 10px; padding: 7px 9px; border: 0; border-radius: 7px; color: var(--text); background: transparent; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.engine-option:hover, .engine-option:focus-visible, .engine-add-action:hover, .engine-add-action:focus-visible { background: var(--hover); outline: none; }
.engine-option:disabled { opacity: .6; cursor: wait; }
.engine-option-check { margin-left: auto; color: var(--accent); }
.engine-add-action { margin-top: 5px; border-top: 1px solid var(--line); border-radius: 0 0 7px 7px; color: var(--accent); }
.engine-picker-error { margin: 7px 9px 5px; color: #ffb0a6; font-size: 11px; }
.engine-load-error { margin: 8px 4px 0; color: #ffb0a6; font-size: 11px; }
</style>
