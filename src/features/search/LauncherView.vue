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
const resultsPanel = ref<HTMLElement>()
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

watch(selectedIndex, async () => {
  await nextTick()
  resultsPanel.value?.querySelector<HTMLElement>('.launcher-result.selected')?.scrollIntoView({ block: 'nearest' })
})

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
  else if (event.key === 'ArrowDown' && selectableCount.value) { event.preventDefault(); selectedIndex.value = (selectedIndex.value + 1) % selectable