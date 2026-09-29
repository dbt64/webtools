<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { ArrowDown, ArrowUp, ArrowUpRight, BookmarkPlus, Command, CornerDownLeft, File, Folder, Globe, Languages, Search } from '@lucide/vue'
import type { AppSearchEntry, BookmarkFolder, WebsiteSearchEntry, EverythingResult, LauncherDataVersions } from '@/shared/domain'
import type { IpcResult } from '@/shared/ipc'
import { isNewerLauncherVisibilityEvent, type LauncherVisibilityEvent } from '@/shared/launcher-visibility'
import logoDark from '@/assets/brand/logo-dark.svg'
import logoLight from '@/assets/brand/logo-light.svg'
import { parseSearchCommand } from '@/shared/search-command'
import { LauncherSearchIndexCache } from './launcher-search-index-cache'
import { useWebsiteIcons } from './use-website-icons'
import {
  appendTranslationAction,
  searchLauncherEntriesLazy,
  toLauncherAction,
  toLauncherAppEntry,
  toLauncherFileAction,
  toLauncherWebsiteEntry,
  type LauncherAction,
  type LauncherEntry,
  type SearchAction,
  type WebsiteAction,
} from './launcher-results'
import { useAppResultIcons } from './use-app-result-icons'
import SearchResultName from './SearchResultName.vue'
import { applyTheme } from '@/shared/theme'
import BookmarkDialog from '../bookmarks/BookmarkDialog.vue'
import Favicon from '../bookmarks/Favicon.vue'

type BookmarkTarget = Pick<WebsiteAction, 'id' | 'name' | 'folderIds'>
interface LauncherApplication { id: string; name: string; icon: Component }
const applications = ref<LauncherApplication[]>([{ id: 'translate', name: '翻译', icon: Languages }])
const query = ref('')
const apps = ref<AppSearchEntry[]>([])
const websites = ref<WebsiteSearchEntry[]>([])
const loadedVersions = ref<LauncherDataVersions>({ apps: -1, websites: -1 })
const rememberedAppId = ref<string | null>(null)
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
let websiteShortcutIconObserver: IntersectionObserver | undefined
let websiteResultIconObserver: IntersectionObserver | undefined
const visibleWebsiteShortcutIconIds = new Set<string>()
const visibleWebsiteResultIconIds = new Set<string>()
let dragPointerId: number | undefined
let dragStartX = 0
let dragStartY = 0
let dragLastX = 0
let dragLastY = 0
let dragStarted = false
let dragBar: HTMLElement | undefined
let capturedClickWasDrag = false
let inputSelection: { start: number | null; end: number | null } | undefined
const bookmarkTarget = ref<BookmarkTarget>()
const showBookmarkDialog = ref(false)
const savingBookmark = ref(false)
const expanded = ref(false)
const websitesExpanded = ref(false)
const applicationsExpanded = ref(false)
const parsed = computed(() => parseSearchCommand(query.value))
const isWeb = computed(() => parsed.value.mode === 'web')
const isFiles = computed(() => parsed.value.mode === 'files')
let appMemoryLookupGeneration = 0
let currentVisibilityGeneration = 0
let launcherVisible = false
let unsubscribeLauncherVisibility: (() => void) | undefined
const appEntries = computed<LauncherEntry[]>(() => apps.value.map(toLauncherAppEntry))
const websiteEntries = computed<LauncherEntry[]>(() => websites.value.map(toLauncherWebsiteEntry))
const indexCache = new LauncherSearchIndexCache<LauncherEntry>()
const index = computed(() => indexCache.get(appEntries.value, websiteEntries.value))
function assertNever(value: never): never { throw new Error(`Unsupported launcher action: ${String(value)}`) }

const searchRows = computed<SearchAction[]>(() => {
  return searchLauncherEntriesLazy(
    parsed.value.query,
    parsed.value.mode,
    appEntries.value,
    websiteEntries.value,
    () => index.value,
    rememberedAppId.value,
  ).map(toLauncherAction)
})
watch(parsed, (command) => {
  const generation = ++appMemoryLookupGeneration
  rememberedAppId.value = null
  if (command.mode !== 'local' || !command.query) return
  const requestedQuery = command.query
  void window.desktop.getRememberedAppSearchAppId(requestedQuery).then((appId) => {
    if (generation !== appMemoryLookupGeneration || parsed.value.mode !== 'local' || parsed.value.query !== requestedQuery) return
    rememberedAppId.value = appId
  }).catch(() => undefined)
}, { immediate: true })
const launcherActions = computed(() => appendTranslationAction(searchRows.value, query.value, parsed.value.mode))
const visibleFileActions = computed<Extract<LauncherAction, { kind: 'file' }>[]>(() => fileResults.value.slice(0, 8).map(toLauncherFileAction))
const selectableActions = computed<LauncherAction[]>(() => isFiles.value ? visibleFileActions.value : isWeb.value ? [] : launcherActions.value)
const selectableCount = computed(() => selectableActions.value.length)
const visibleAppIds = computed(() => launcherActions.value.flatMap((action) => action.kind === 'application' ? [action.id] : []))
const appIcons = useAppResultIcons(visibleAppIds)
const websiteIcons = useWebsiteIcons(computed(() => loadedVersions.value.websites))
const websiteIconMap = websiteIcons.icons

watch(selectableActions, () => { selectedIndex.value = 0 })

watch(selectedIndex, async () => {
  await nextTick()
  resultsPanel.value?.querySelector<HTMLElement>('.launcher-result.selected')?.scrollIntoView({ block: 'nearest' })
})

async function focus(generation: number): Promise<void> {
  await nextTick()
  if (!launcherVisible || generation !== currentVisibilityGeneration) return
  input.value?.focus()
  if (!query.value) input.value?.select()
}

let launcherDataLoad: Promise<void> | undefined
function loadLauncherData(checkAgainAfterCurrent = false): Promise<void> {
  if (launcherDataLoad) return checkAgainAfterCurrent ? launcherDataLoad.then(() => loadLauncherData()) : launcherDataLoad
  // Electron IPC cannot clone Vue's reactive proxy; send a plain snapshot.
  const knownVersions = { ...loadedVersions.value }
  const request = Promise.resolve().then(() => window.desktop.getLauncherData(knownVersions)).then((changes) => {
    if (changes.apps !== undefined) apps.value = changes.apps
    if (changes.websites !== undefined) websites.value = changes.websites
    loadedVersions.value = changes.versions
  }).catch(() => undefined)
  launcherDataLoad = request.finally(() => { launcherDataLoad = undefined })
  return launcherDataLoad
}

async function hide(): Promise<void> {
  await window.desktop.hideLauncher()
}

async function openWebsite(website: WebsiteSearchEntry): Promise<void> {
  const result = await window.desktop.openWebsite(website.id)
  if (!result.ok) { error.value = result.error.message; return }
  await hide()
}

function syncWindowSize(): void {
  if (!launcherVisible) return
  const hasSearchResults = Boolean(query.value.trim())
  const isExpanded = expanded.value || hasSearchResults
  const expandedSectionExtraHeight = expanded.value
    ? (websitesExpanded.value ? 180 : 0) + (applicationsExpanded.value ? 120 : 0)
    : 0
  void window.desktop.setLauncherExpanded(isExpanded, expandedSectionExtraHeight, hasSearchResults, currentVisibilityGeneration)
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
  if (typeof ResizeObserver !== 'undefined') {
    shortcutResizeObserver ??= new ResizeObserver(() => measureExpandableSections())
    for (const container of [websiteShortcutList.value, applicationShortcutList.value]) {
      if (!container) continue
      shortcutResizeObserver.observe(container)
      container.querySelectorAll('.launcher-shortcut').forEach((card) => shortcutResizeObserver?.observe(card))
    }
  }
  observeVisibleWebsiteIcons()
}

function observeVisibleWebsiteIcons(): void {
  websiteShortcutIconObserver?.disconnect()
  websiteResultIconObserver?.disconnect()
  const shortcutRoot = expanded.value && !query.value.trim() ? websiteShortcutList.value : undefined
  if (shortcutRoot) {
    const cards = [...shortcutRoot.querySelectorAll<HTMLElement>('[data-website-id]')]
    const availableIds = new Set(cards.flatMap((card) => card.dataset.websiteId ? [card.dataset.websiteId] : []))
    for (const id of visibleWebsiteShortcutIconIds) if (!availableIds.has(id)) visibleWebsiteShortcutIconIds.delete(id)
    if (typeof IntersectionObserver === 'undefined') {
      visibleWebsiteShortcutIconIds.clear()
      for (const card of cards.slice(0, 16)) if (card.dataset.websiteId) visibleWebsiteShortcutIconIds.add(card.dataset.websiteId)
    } else {
      websiteShortcutIconObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.websiteId
          if (!id) continue
          if (entry.isIntersecting) visibleWebsiteShortcutIconIds.add(id)
          else visibleWebsiteShortcutIconIds.delete(id)
        }
        websiteIcons.setVisibleShortcutIds([...visibleWebsiteShortcutIconIds])
      }, { root: shortcutRoot, threshold: 0.01 })
      for (const card of cards) websiteShortcutIconObserver.observe(card)
    }
  } else {
    visibleWebsiteShortcutIconIds.clear()
  }
  const resultRoot = resultsPanel.value
  if (resultRoot) {
    const rows = [...resultRoot.querySelectorAll<HTMLElement>('[data-website-result-id]')]
    const availableIds = new Set(rows.flatMap((row) => row.dataset.websiteResultId ? [row.dataset.websiteResultId] : []))
    for (const id of visibleWebsiteResultIconIds) if (!availableIds.has(id)) visibleWebsiteResultIconIds.delete(id)
    if (typeof IntersectionObserver === 'undefined') {
      visibleWebsiteResultIconIds.clear()
      for (const row of rows) if (row.dataset.websiteResultId) visibleWebsiteResultIconIds.add(row.dataset.websiteResultId)
    } else {
      websiteResultIconObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.websiteResultId
          if (!id) continue
          if (entry.isIntersecting) visibleWebsiteResultIconIds.add(id)
          else visibleWebsiteResultIconIds.delete(id)
        }
        websiteIcons.setVisibleResultIds([...visibleWebsiteResultIconIds])
      }, { root: resultRoot, threshold: 0.01 })
      for (const row of rows) websiteResultIconObserver.observe(row)
    }
  } else {
    visibleWebsiteResultIconIds.clear()
  }
  websiteIcons.setVisibleShortcutIds([...visibleWebsiteShortcutIconIds])
  websiteIcons.setVisibleResultIds([...visibleWebsiteResultIconIds])
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
  const action = selectableActions.value[selectedIndex.value]
  if (!action) return
  await dispatchAction(action)
}

async function dispatchAction(action: LauncherAction): Promise<void> {
  const searchQuery = action.kind === 'application' && parsed.value.mode === 'local' ? parsed.value.query : ''
  let result: IpcResult<void>
  switch (action.kind) {
    case 'application': result = await window.desktop.launchApp(action.id); break
    case 'website': result = await window.desktop.openWebsite(action.id); break
    case 'file': result = await window.desktop.openEverythingResult(action.id); break
    case 'translation': result = await window.desktop.openTranslation(action.text); break
    default: return assertNever(action)
  }
  if (!result.ok) { error.value = result.error.message; return }
  if (action.kind === 'application' && searchQuery) {
    try { await window.desktop.rememberAppSearchResult(searchQuery, action.id) } catch { /* Launch succeeded; remembering the query must not change its outcome. */ }
  }
  await hide()
}

async function promptBookmark(entry: WebsiteAction): Promise<void> {
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
    const target = bookmarkTarget.value
    if (!folderId || !target) return
    const result = await window.desktop.addWebsiteToFolders(target.id, [...new Set([...target.folderIds, folderId])])
    if (!result.ok) { error.value = result.error.message; return }
    await loadLauncherData(true)
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

function handleLauncherVisibility(event: LauncherVisibilityEvent): void {
  if (!isNewerLauncherVisibilityEvent(currentVisibilityGeneration, event.generation)) return
  currentVisibilityGeneration = event.generation
  launcherVisible = event.kind === 'shown'
  if (event.kind === 'hidden') {
    ++fileSearchSequence
    ++appMemoryLookupGeneration
    query.value = ''
    expanded.value = false
    websitesExpanded.value = false
    applicationsExpanded.value = false
    selectedIndex.value = 0
    fileResults.value = []
    fileStatus.value = ''
    rememberedAppId.value = null
    error.value = ''
    showBookmarkDialog.value = false
    bookmarkTarget.value = undefined
    visibleWebsiteResultIconIds.clear()
    visibleWebsiteShortcutIconIds.clear()
    websiteIcons.setVisibleResultIds([])
    websiteIcons.setVisibleShortcutIds([])
    return
  }
  applyTheme(event.theme)
  expanded.value = event.launcherDisplayMode === 'expanded'
  websitesExpanded.value = false
  applicationsExpanded.value = false
  error.value = ''
  void loadLauncherData()
  syncWindowSize()
  void focus(event.generation).finally(() => window.desktop.acknowledgeLauncherVisibility(event.generation))
}

onMounted(() => {
  void loadLauncherData()
  void observeShortcutSections()
  unsubscribeLauncherVisibility = window.desktop.onLauncherVisibility(handleLauncherVisibility)
  window.desktop.launcherReady()
})

watch([websites, expanded, query], () => { void observeShortcutSections() }, { deep: true, flush: 'post' })
watch(applications, () => { if (expanded.value) void observeShortcutSections() }, { deep: true })
watch(launcherActions, observeVisibleWebsiteIcons, { flush: 'post' })

onBeforeUnmount(() => {
  unsubscribeLauncherVisibility?.()
  shortcutResizeObserver?.disconnect()
  websiteShortcutIconObserver?.disconnect()
  websiteResultIconObserver?.disconnect()
  visibleWebsiteShortcutIconIds.clear()
  visibleWebsiteResultIconIds.clear()
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
          <img class="launcher-brand-logo launcher-brand-logo-dark" :src="logoDark" alt="" />
          <img class="launcher-brand-logo launcher-brand-logo-light" :src="logoLight" alt="" />
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
          <div ref="websiteShortcutList" class="launcher-shortcut-list website-shortcut-list launcher-scrollable" :class="{ expanded: websitesExpanded }">
            <button v-for="website in websites" :key="website.id" class="launcher-shortcut" :data-website-id="website.id" :title="website.url" @mousedown.prevent @click="openWebsite(website)">
              <Favicon :url="website.url" :favicon="websiteIconMap[website.id]" />
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
          <button v-for="(result, idx) in visibleFileActions" :key="`file:${result.id}`" class="launcher-result" :class="{ selected: selectedIndex === idx }" @mousedown.prevent @mouseenter="selectedIndex = idx" @click="dispatchAction(result)">
            <span class="launcher-result-icon file-result-icon"><Folder v-if="result.fileKind === 'folder'" :size="17" /><File v-else :size="17" /></span>
            <span class="launcher-result-copy"><strong>{{ result.name }}</strong><small>{{ result.locationLabel }}</small></span>
            <CornerDownLeft v-if="selectedIndex === idx" :size="15" class="launcher-enter-icon" />
          </button>
          <div v-if="fileStatus" class="launcher-empty">{{ fileStatus }}</div>
        </template>
        <template v-else>
          <div v-for="(result, idx) in launcherActions" :key="result.kind + ':' + (result.kind === 'translation' ? 'translate' : result.id)" class="launcher-result-wrap" :data-website-result-id="result.kind === 'website' ? result.id : undefined">
            <button class="launcher-result" :class="{ selected: selectedIndex === idx }" @mousedown.prevent @mouseenter="selectedIndex = idx" @click="dispatchAction(result)">
              <span class="launcher-result-icon">
                <img v-if="result.kind === 'application' && appIcons[result.id]" class="favicon-image" :src="appIcons[result.id]" alt="" />
                <Favicon v-else-if="result.kind === 'website'" :url="result.url" :favicon="websiteIconMap[result.id]" />
                <Languages v-else-if="result.kind === 'translation'" :size="17" />
                <Command v-else :size="17" />
              </span>
              <span class="launcher-result-copy"><SearchResultName :name="result.name" :query="parsed.query" /><small>{{ result.subtitle }}</small></span>
              <span v-if="(result.kind === 'application' || result.kind === 'website') && result.match !== 'name'" class="launcher-result-match">{{ result.match === 'pinyin' ? '拼音' : result.match === 'alias' ? '别名' : '首字母' }}</span>
              <CornerDownLeft v-if="selectedIndex === idx" :size="15" class="launcher-enter-icon" />
            </button>
            <button v-if="result.kind === 'website'" class="launcher-add" title="添加到收藏夹" @mousedown.prevent @click="promptBookmark(result)"><BookmarkPlus :size="16" /></button>
          </div>
          <div v-if="!launcherActions.length && parsed.mode === 'saved-websites' && !parsed.query" class="launcher-empty">输入网址名称或网址片段，搜索已收藏的网址。</div>
          <div v-else-if="!launcherActions.length" class="launcher-empty">{{ parsed.mode === 'saved-websites' ? '没有找到匹配的收藏网址' : '没有找到匹配的应用或网址' }}</div>
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
