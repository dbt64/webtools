<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Bookmark, Command, CornerDownLeft, File, Folder, Languages, Search, Sparkles, SquareArrowOutUpRight,
} from '@lucide/vue'
import { createDefaultAppData, type AppSearchEntry, type AppSettings, type WebsiteEntry, type EverythingResult } from '@/shared/domain'
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
const fileResults = ref<EverythingResult[]>([])
const fileStatus = ref('')
let fileSearchSequence = 0
const parsed = computed(() => parseSearchCommand(query.value))
const isWebSearch = computed(() => parsed.value.mode === 'web')
const isFileSearch = computed(() => parsed.value.mode === 'files')
const defaultEngineName = computed(() => settings.value.searchEngines.find((engine) => engine.id === settings.value.defaultSearchEngineId)?.name ?? '默认搜索引擎')
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

async function addSearchResultBookma