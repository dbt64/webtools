<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Bookmark, Command, Compass, Languages, Search, Sparkles, SquareArrowOutUpRight, Wrench,
} from '@lucide/vue'
import type { AppEntry, AppSettings, ToolEntry, WebEntry } from '@/shared/domain'
import { buildSearchIndex } from '@/shared/pinyin-index'
import { searchEntries, type SearchableEntry, type SearchResult as SearchResultItem } from '@/shared/search'
import { parseSearchCommand } from '@/shared/search-command'
import SearchResult from './SearchResult.vue'
import BookmarkDialog from '../bookmarks/BookmarkDialog.vue'
import type { BookmarkFolder } from '@/shared/domain'

const emit = defineEmits<{ navigate: [section: 'bookmarks' | 'entries' | 'translate'] }>()

const apps = ref<AppEntry[]>([])
const webEntries = ref<WebEntry[]>([])
const tools = ref<ToolEntry[]>([])
const settings = ref<AppSettings>({ defaultSearchProvider: 'google', aiBaseUrl: '', aiModel: '' })
const query = ref('')
const selectedIndex = ref(0)
const searchInput = ref<HTMLInputElement>()
const bookmarkFolders = ref<BookmarkFolder[]>([])
const bookmarkTarget = ref<SearchableEntry>()
const showBookmarkDialog = ref(false)
const parsed = computed(() => parseSearchCommand(query.value))
const isWebSearch = computed(() => parsed.value.mode === 'web')
const providerNames = { google: 'Google', baidu: '百度', bilibili: 'Bilibili' }
const searchableEntries = computed<SearchableEntry[]>(() => [
  ...apps.value.map((entry) => ({ id: entry.id, name: entry.name, kind: 'app' as const, subtitle: entry.targetPath })),
  ...webEntries.value.map((entry) => ({ id: entry.id, name: entry.name, kind: 'website' as const, subtitle: entry.url, searchText: `${entry.url} ${entry.description ?? ''}` })),
  ...tools.value.map((entry) => ({ id: entry.id, name: entry.name, kind: 'tool' as const, subtitle: entry.command, searchText: `${entry.command} ${entry.description ?? ''}` })),
])
const index = computed(() => buildSearchIndex(searchableEntries.value))
const results = computed(() => isWebSearch.value ? [] : searchEntries(parsed.value.query, searchableEntries.value, index.value))

async function loadApps(refresh = false): Promise<void> {
  try {
    const [loadedApps, entries, loadedSettings] = await Promise.all([
      refresh ? window.desktop.refreshApps() : window.desktop.getApps(),
      window.desktop.getEntries(),
      window.desktop.getSettings(),
    ])
    apps.value = loadedApps
    webEntries.value = entries.webEntries
    tools.value = entries.tools
    settings.value = loadedSettings
  } catch {
    // Show an empty result state while keeping the search box usable.
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
    : selected.entry.kind === 'website'
      ? await window.desktop.openWebEntry(selected.entry.id)
      : await window.desktop.openToolEntry(selected.entry.id)
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

async function saveBookmark(input: { folderId?: string; newFolderName?: string; title: string; url: string }): Promise<void> {
  let folderId = input.folderId
  if (input.newFolderName) {
    const folder = await window.desktop.saveBookmarkFolder({ name: input.newFolderName })
    if (!folder.ok) { window.alert(folder.error.message); return }
    folderId = folder.data.id
  }
  if (!folderId) return
  const result = await window.desktop.addBookmark({ folderId, title: input.title || bookmarkTarget.value?.name, url: input.url })
  if (!result.ok) { window.alert(result.error.message); return }
  showBookmarkDialog.value = false
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
        <span>{{ providerNames[settings.defaultSearchProvider] }} · {{ parsed.query ? `按 Enter 搜索“${parsed.query}”` : '请输入关键词' }}</span>
      </template>
      <template v-else>
        <span class="mode-chip"><Command :size="13" /> 本地搜索</span>
        <span>{{ results.length }} 项 · 应用支持拼音和首字母</span>
        <button class="refresh-button" title="重新扫描应用" @click="loadApps(true)">重新扫描</button>
      </template>
    </div>

    <div v-if="query && !isWebSearch" class="result-list" role="listbox" aria-label="应用搜索结果">
      <SearchResult
        v-for="(result, resultIndex) in results"
        :key="`${result.entry.kind}-${result.entry.id}`"
        :result="result"
        :selected="resultIndex === selectedIndex"
        @select="launchSelected"
        @bookmark="addSearchResultBookmark(result)"
        @mouseenter="selectedIndex = resultIndex"
      />
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
        <button class="quick-card" @click="emit('navigate', 'bookmarks')">
          <span class="quick-card-icon bookmark-icon"><Bookmark :size="17" /></span>
          <span class="quick-card-text"><strong>收藏网址</strong><small>整理稍后再看的页面</small></span>
          <span class="card-plus">+</span>
        </button>
        <button class="quick-card" @click="emit('navigate', 'translate')">
          <span class="quick-card-icon translate-icon"><Languages :size="17" /></span>
          <span class="quick-card-text"><strong>快速翻译</strong><small>AI 或 Google Translate</small></span>
          <span class="card-plus">+</span>
        </button>
        <button class="quick-card" @click="emit('navigate', 'entries')">
          <span class="quick-card-icon tools-icon"><Wrench :size="17" /></span>
          <span class="quick-card-text"><strong>常用工具</strong><small>管理网址和桌面工具</small></span>
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
      :initial-title="bookmarkTarget.name"
      :initial-url="bookmarkTarget.subtitle"
      @save="saveBookmark"
      @cancel="showBookmarkDialog = false"
    />
  </section>
</template>
