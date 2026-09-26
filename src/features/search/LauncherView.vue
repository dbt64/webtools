<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { ArrowDown, ArrowUp, ArrowUpRight, BookmarkPlus, Command, CornerDownLeft, File, Folder, Globe, Languages, Search } from '@lucide/vue'
import type { AppSearchEntry, BookmarkFolder, WebsiteEntry, EverythingResult, LauncherDisplayMode, ThemePreference } from '@/shared/domain'
import { buildSearchIndex } from '@/shared/pinyin-index'
import { searchEntries, type SearchableEntry } from '@/shared/search'
import { parseSearchCommand } from '@/shared/search-command'
import { applyTheme } from '@/shared/theme'
import BookmarkDialog from '../bookmarks/BookmarkDialog.vue'
import Favicon from '../bookmarks/Favicon.vue'

interface LauncherEntry extends SearchableEntry { favicon?: string; url?: string }
interface LauncherApplication { id: string; name: string; icon: Component }
const applications = ref<LauncherApplication[]>([{ id: 'translate', name: '翻译', icon: Languages }])
const query = ref('')
const apps = ref<AppSearchEntry[]>([])
const websites = ref<WebsiteEntry[]>([])
const folders = ref<BookmarkFolder[]>([])
const selectedIndex = ref(0)
const input = ref<HTMLInputElement>()
const resultsPanel = ref<HTMLElement>()
const websiteShortcutList = ref<HTMLElement>()
const applicationShortcutList = ref<HTMLElement>()
const websitesCanExpand = ref(false)
const applicationsCanExpand = ref(false)
const error = ref('')
const fileResults = ref<EverythingResult[]>([])
const fileStatus = ref('')
let fileSearchSequence = 0
let shortcutResizeObserver: ResizeObserver | undefined
let dragPointerId: number | undefined
let dragStartX = 0
let dragStartY = 0
let dragLastX = 0
let dragLastY = 0
let dragStarted = false
let dragBar: HTMLElement | undefined
let capturedClickWasDrag = false
let inputSelection: { start: number | null; end: number | null } | undefined
const bookmarkTarget = ref<LauncherEntry>()
const showBookmarkDialog = ref(false)
const savingBookmark = ref(false)
const expanded = ref(false)
const websitesExpanded = ref(false)
const applicationsExpanded = ref(false)
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
  expanded.value = false
  websitesExpanded.value = false
  applicationsExpanded.value = false
  await window.desktop.setLauncherExpanded(false)
  await window.desktop.hideLauncher()
}

async function openWebsite(website: WebsiteEntry): Promise<void> {
  const result = await window.desktop.openWebsite(website.id)
  if (!result.ok) { error.value = result.error.message; return }
  await hide()
}

function syncWindowSize(): void {
  const hasSearchResults = Boolean(query.value.trim())
  const isExpanded = expanded.value || hasSearchResults
  const expandedSections = expanded.value
    ? Number(websitesExpanded.value) + Number(applicationsExpanded.value)
    : 0
  void window.desktop.setLauncherExpanded(isExpanded, expandedSections, hasSearchResults)
}

function toggleExpanded(): void {
  expanded.value = !expanded.value
  if (!expanded.value) {
    websitesExpanded.value = false
    applicationsExpanded.value = false
  }
  syncWindowSize()
}

function toggleSection(section: 'websites' | 'applications'): void {
  if (section === 'websites') {
    if (!websitesCanExpand.value) return
    websitesExpanded.value = !websitesExpanded.value
  } else {
    if (!applicationsCanExpand.value) return
    applicationsExpanded.value = !applicationsExpanded.value
  }
  syncWindowSize()
}

function measureExpandableSections(): void {
  const hasMultipleRows = (container?: HTMLElement): boolean => {
    if (!container) return false
    const cards = [...container.querySelectorAll<HTMLElement>('.launcher-shortcut')]
    return cards.some((card) => card.offsetTop > (cards[0]?.offsetTop ?? 0) + 1)
  }
  websitesCanExpand.value = hasMultipleRows(websiteShortcutList.value)
  applicationsCanExpand.value = hasMultipleRows(applicationShortcutList.value)
}

async function observeShortcutSections(): Promise<void> {
  await nextTick()
  shortcutResizeObserver?.disconnect()
  measureExpandableSections()
  if (typeof ResizeObserver === 'undefined') return
  shortcutResizeObserver ??= new ResizeObserver(() => measureExpandableSections())
  for (const container of [websiteShortcutList.value, applicationShortcutList.value]) {
    if (!container) continue
    shortcutResizeObserver.observe(container)
    container.querySelectorAll('.launcher-shortcut').forEach((card) => shortcutResizeObserver?.observe(card))
  }
}

function beginBarPointer(event: PointerEvent): void {
  if (event.button !== 0 || dragPointerId !== undefined) return
  const target = event.target instanceof Element ? event.target : undefined
  if (target?.closest('.launcher-brand')) return
  dragPointerId = event.pointerId
  dragStartX = dragLastX = event.screenX
  dragStartY = dragLastY = event.screenY
  dragStarted = false
  capturedClickWasDrag = false
  dragBar = event.currentTarget as HTMLElement
  inputSelection = target?.closest('input') === input.value && input.value
    ? { start: input.value.selectionStart, end: input.value.selectionEnd }
    : undefined
  window.addEventListener('pointermove', moveBarPointer)
  window.addEventListener('pointerup', endBarPointer)
  window.addEventListener('pointercancel', endBarPointer)
}

function moveBarPointer(event: PointerEvent): void {
  if (event.pointerId !== dragPointerId) return
  if (!dragStarted && Math.hypot(event.screenX - dragStartX, event.screenY - dragStartY) < 5) return
  if (!dragStarted) dragBar?.setPointerCapture(event.pointerId)
  dragStarted = true
  event.preventDefault()
  document.documentElement.classList.add('launcher-dragging')
  const deltaX = event.screenX - dragLastX
  const deltaY = event.screenY - dragLastY
  dragLastX = event.screenX
  dragLastY = event.screenY
  if (deltaX || deltaY) window.desktop.moveLauncherBy(deltaX, deltaY)
}

function endBarPointer(event: PointerEvent): void {
  if (event.pointerId !== dragPointerId) return
  capturedClickWasDrag = event.type === 'pointerup' && dragStarted
  if (dragStarted && input.value && inputSelection) {
    input.value.setSelectionRange(inputSelection.start, inputSelection.end)
  }
  document.documentElement.classList.remove('launcher-dragging')
  window.removeEventListener('pointermove', moveBarPointer)
  window.removeEventListener('pointerup', endBarPointer)
  window.removeEventListener('pointercancel', endBarPointer)
  if (dragBar?.hasPointerCapture(event.pointerId)) dragBar.releasePointerCapture(event.pointerId)
  dragBar = undefined
  dragPointerId = undefined
  dragStarted = false
  inputSelection = undefined
}

function handleCapturedBarClick(event: MouseEvent): void {
  if (capturedClickWasDrag) {
    event.preventDefault()
    event.stopPropagation()
    capturedClickWasDrag = false
  }
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
  syncWindowSize()
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

function handleLauncherShow(event: Event): void {
  const detail = event instanceof CustomEvent
    ? event.detail as { launcherDisplayMode?: unknown; theme?: unknown } | undefined
    : undefined
  const launcherDisplayMode: LauncherDisplayMode = detail?.launcherDisplayMode === 'expanded' ? 'expanded' : 'compact'
  const theme: ThemePreference = detail?.theme === 'light' || detail?.theme === 'dark' || detail?.theme === 'system' ? detail.theme : 'dark'
  applyTheme(theme)
  query.value = ''
  expanded.value = launcherDisplayMode === 'expanded'
  websitesExpanded.value = false
  applicationsExpanded.value = false
  error.value = ''
  void load()
  syncWindowSize()
  void focus()
}

onMounted(() => {
  void load()
  void focus()
  void observeShortcutSections()
  window.addEventListener('webtools-launcher-show', handleLauncherShow)
  window.desktop.launcherReady()
})

watch([websites, expanded], () => { if (expanded.value) void observeShortcutSections() }, { deep: true })
watch(applications, () => { if (expanded.value) void observeShortcutSections() }, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('webtools-launcher-show', handleLauncherShow)
  shortcutResizeObserver?.disconnect()
  document.documentElement.classList.remove('launcher-dragging')
})
</script>

<template>
  <main class="launcher-shell">
    <section class="launcher-panel">
      <div class="launcher-bar" @pointerdown="beginBarPointer" @click.capture="handleCapturedBarClick">
        <Search class="launcher-search-icon" :size="20" />
        <input ref="input" v-model="query" placeholder="搜索应用，输入 ? 搜索网页" autocomplete="off" spellcheck="false" @keydown="keydown" />
        <button class="launcher-brand" aria-label="打开 WebTools 管理界面" title="打开 WebTools" @mousedown.prevent @click="openManager">
          <Command :size="19" :stroke-width="2.4" />
        </button>
      </div>
      <div v-if="expanded && !query.trim()" class="launcher-content">
        <section class="launcher-section">
          <header class="launcher-section-heading">
            <h2>收藏网址</h2>
            <button class="launcher-section-toggle" :disabled="!websitesCanExpand" :aria-expanded="websitesExpanded" aria-label="展开或收起收藏网址" @mousedown.prevent @click="toggleSection('websites')">
              <span>{{ websitesExpanded ? '收起' : '展开' }}</span>
              <ArrowUp v-if="websitesExpanded" :size="12" />
              <ArrowDown v-else :size="12" />
            </button>
          </header>
          <div ref="websiteShortcutList" class="launcher-shortcut-list launcher-scrollable" :class="{ expanded: websitesExpanded }">
            <button v-for="website in websites" :key="website.id" class="launcher-shortcut" :title="website.url" @mousedown.prevent @click="openWebsite(website)">
              <Favicon :url="website.url" :favicon="website.favicon" />
              <span>{{ website.name }}</span>
            </button>
            <p v-if="!websites.length" class="launcher-shortcut-empty">收藏的网址会显示在这里</p>
          </div>
        </section>
        <section class="launcher-section">
          <header class="launcher-section-heading">
            <h2>应用</h2>
            <button class="launcher-section-toggle" :disabled="!applicationsCanExpand" :aria-expanded="applicationsExpanded" aria-label="展开或收起应用" @mousedown.prevent @click="toggleSection('applications')">
              <span>{{ applicationsExpanded ? '收起' : '展开' }}</span>
              <ArrowUp v-if="applicationsExpanded" :size="12" />
              <ArrowDown v-else :size="12" />
            </button>
          </header>
          <div ref="applicationShortcutList" class="launcher-shortcut-list launcher-scrollable" :class="{ expanded: applicationsExpanded }">
            <button v-for="application in applications" :key="application.id" class="launcher-shortcut launcher-app-shortcut" :title="`打开${application.name}`" @mousedown.prevent @click="openManager">
              <span class="launcher-app-icon"><component :is="application.icon" :size="18" /></span>
              <span>{{ application.name }}</span>
            </button>
          </div>
        </section>
      </div>
      <section v-if="query.trim()" ref="resultsPanel" class="launcher-results launcher-scrollable">
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
    </section>
    <button class="launcher-toggle" :aria-expanded="expanded" :aria-label="expanded ? '收起快捷内容' : '展开快捷内容'" @mousedown.prevent @click="toggleExpanded">
      <span>{{ expanded ? '收起' : '展开' }}</span>
      <ArrowUp v-if="expanded" :size="13" />
      <ArrowDown v-else :size="13" />
    </button>
    <footer v-if="query.trim()" class="launcher-foot"><span>↑↓ 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span><span class="launcher-foot-spacer"></span><span><ArrowUpRight :size="12" /> WebTools</span></footer>
    <BookmarkDialog v-if="showBookmarkDialog && bookmarkTarget" :folders="folders" :website-name="bookmarkTarget.name" :saving="savingBookmark" @save="saveBookmark" @cancel="showBookmarkDialog = false" />
  </main>
</template>
