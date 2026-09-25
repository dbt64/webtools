<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Bookmark, Command, Languages, Search, Sparkles, SquareArrowOutUpRight,
} from '@lucide/vue'
import { createDefaultAppData, type AppSearchEntry, type AppSettings, type WebsiteEntry } from '@/shared/domain'
import { buildSearchIndex } from '@/shared/pinyin-index'
import { searchEntries, type SearchableEntry, type SearchResult as SearchResultItem } from '@/shared/search'
import { parseSearchCommand } from '@/shared/search-command'
import SearchResult from './SearchResult.vue'
import BookmarkDialog from '../bookmarks/BookmarkDialog.vue'
import type { BookmarkFolder } from '@/shared/domain'

const emit = defineEmits<{ navigate: [section: 'entries' | 'translate'] }>()

const apps = ref<AppSearchEntry[]>([])
const webEntries = ref<WebsiteEntry[]>([])
const settings = ref<AppSettings>(createDefaultAppData().settings)
const query = ref('')
const selectedIndex = ref(0)
const searchInput = ref<HTMLInputElement>()
const bookmarkFolders = ref<BookmarkFolder[]>([])
const bookmarkTarget = ref<SearchableEntry>()
const showBookmarkDialog = ref(false)
const savingBookmark = ref(false)
const refreshing = ref(false)
const parsed = computed(() => parseSearchCommand(query.value))
const isWebSearch = computed(() => parsed.value.mode === 'web')
const defaultEngineName = computed(() => settings.value.searchEngines.find((engine) => engine.id === settings.value.defaultSearchEngineId)?.name ?? '默认搜索引擎')
const searchableEntries = computed<SearchableEntry[]>(() => [
  ...apps.value.map((entry) => ({ id: entry.id, name: entry.name, aliases: entry.aliases, kind: 'app' as const, subtitle: '本地应用' })),
  ...webEntries.value.map((entry) => ({ id: entry.id, name: entry.name, kind: 'website' as const, subtitle: entry.url, url: entry.url, folderIds: entry.folderIds, searchText: `${entry.url} ${entry.description ?? ''}` })),
])
const index = computed(() => buildSearchIndex(searchableEntries.value))
const results = computed(() => isWebSearch.value ? [] : searchEntries(parsed.value.query, searchableEntries.value, index.value))
const resultGroups = computed(() => [
  { kind: 'app' as const, label: '应用', items: results.value.filter((result) => result.entry.kind === 'app') },
  { kind: 'website' as const, label: '网址', items: results.value.filter((result) => result.entry.kind === 'website') },
].filter((group) => group.items.length))

async function loadApps(refresh = false): Promise<void> {
  refreshing.value = refresh
  try {
    const [loadedApps, entries, loadedSettings] = await Promise.all([
      refresh ? window.desktop.refreshApps() : window.desktop.getApps(),
      window.desktop.listWebsites(),
      window.desktop.getSettings(),
    ])
    apps.value = loadedApps
    webEntries.value = entries
    settings.value = loadedSettings
  } catch {
    // Show an empty result state while keeping the search box usable.
  } finally {
    refreshing.value = false
  }
}

async function launchSelected(): Promise<void> {
  const selected = results.value[selectedIndex.value]
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
  if (event.key === 'ArrowDown' && results.value.length) {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % results.value.length
  } else if (event.key === 'ArrowUp' && results.value.length) {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + results.value.length) % results.value.length
  } else if (event.key === 'Enter' && isWebSearch.value && parsed.value.query) {
    event.preventDefault()
    void launchSelected()
  } else if (event.key === 'Enter' && results.value.length) {
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

watch(query, () => { selectedIndex.value = 0 })
onMounted(() => {
  void loadApps()
  searchInput.value?.focus()
})
</script>

<template>
  <section class="search-page">
    <div class="welcome-block">
      <div class="welcome-icon"><Sparkles :size="17" /></div>
      <p class="eyebrow">一处开始，随手可达</p>
      <h1>接下来要做什么？</h1>
      <p class="welcome-copy">搜索应用、打开常用网址，或者用 <kbd>?</kbd> 开始网页搜索。</p>
    </div>

    <label class="search-box" for="quick-search">
      <Search :size="20" class="search-icon" />
      <input
        id="quick-search"
        ref="searchInput"
        v-model="query"
        autocomplete="off"
        placeholder="搜索应用、网址或工具…"
        spellcheck="false"
        @keydown="handleKeydown"
      />
      <span class="search-hint"><kbd>Ctrl</kbd><kbd>K</kbd></span>
    </label>

    <div v-if="query" class="search-feedback">
      <template v-if="isWebSearch">
        <span class="mode-chip"><Search :size="13" /> 网页搜索</span>
        <span>{{ defaultEngineName }} · {{ parsed.query ? `按 Enter 搜索“${parsed.query}”` : '请输入关键词' }}</span>
      </template>
      <template v-else>
        <span class="mode-chip"><Command :size="13" /> 本地搜索</span>
        <span>{{ results.length }} 项 · 应用支持拼音和首字母</span>
        <button class="refresh-button" :disabled="refreshing" title="重新扫描应用" @click="loadApps(true)">{{ refreshing ? '扫描中…' : '重新扫描' }}</button>
      </template>
    </div>

    <div v-if="query && !isWebSearch" class="result-list" role="listbox" aria-label="应用搜索结果">
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
