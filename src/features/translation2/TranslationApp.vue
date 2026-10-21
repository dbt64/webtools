<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, toRaw } from 'vue'
import { Check, Copy, Eye, EyeOff, FileUp, GripVertical, Minus, Pencil, Pin, Play, RotateCcw, Settings2, Trash2, X } from '@lucide/vue'
import { TRANSLATION_LANGUAGES, type TranslationLanguageCode, type TranslationSourceLanguage } from '@/shared/translation-contracts.ts'
import { isAIProviderId } from '@/shared/ai-config.ts'
import TranslationServiceEditor from './TranslationServiceEditor.vue'
import type { AIProviderId } from '@/shared/ai-config.ts'
import type { Translation2Bootstrap } from '@/shared/translation2-ipc.ts'
import type { Translation2ServiceSelection, Translation2TabSelection, Translation2WebsiteProviderId, Translation2WorkspaceSettings } from '@/shared/translation2-contracts.ts'
import { parseTranslation2ImportedApiDefinition } from '@/shared/translation2-contracts.ts'
import {
  applyTranslation2Open,
  buildTranslation2ServiceGroups,
  buildTranslation2Tabs,
  createTranslation2ViewState,
  isTranslation2RequestCurrent,
} from './translation2-view-model.ts'

const props = defineProps<{ initialBootstrap: Translation2Bootstrap | null }>()
const bootstrap = ref(props.initialBootstrap)
const loadingBootstrap = ref(!props.initialBootstrap)
const fatalError = ref('')
const settingsOpen = ref(false)
const pinned = ref(props.initialBootstrap?.pinned ?? false)
const serviceEditorOpen = ref(false)
const copied = ref(false)
const importFile = ref<HTMLInputElement | null>(null)
const importedDefinition = ref<unknown | null>(null)
const importedFileName = ref('')
const importedName = ref('')
const importedSecret = ref('')
const importedSecretVisible = ref(false)
const importedTested = ref(false)
const importedMessage = ref('')
const editingServiceId = ref('')
const editingName = ref('')
const editingSecret = ref('')
const editingSecretVisible = ref(false)
const websiteSyncNotice = ref('')
const websiteStatus = ref<{ providerId: string; phase: string; message: string } | null>(null)
const draggingWebsiteId = ref<Translation2WebsiteProviderId | null>(null)
const dropTargetWebsiteId = ref<Translation2WebsiteProviderId | null>(null)
const dropAfterWebsite = ref(false)
const websitePane = ref<HTMLElement | null>(null)
const sourceLanguage = ref<TranslationSourceLanguage>(props.initialBootstrap?.languageDefaults.sourceLanguage ?? 'auto')
const targetLanguage = ref<TranslationLanguageCode>(props.initialBootstrap?.languageDefaults.targetLanguage ?? 'zh-CN')
const state = reactive(createTranslation2ViewState(props.initialBootstrap?.open ?? { generation: 0, sourceText: null }))
let removeOpened: (() => void) | undefined
let removeWebsiteState: (() => void) | undefined
let tabRevision = 0
let settingsWrite: Promise<void> = Promise.resolve()
let tabSelectionPending = false
let websiteResizeObserver: ResizeObserver | undefined
let autoTranslateTimer: ReturnType<typeof window.setTimeout> | undefined
let lastAutoTranslateSignature = ''

const workspace = computed(() => bootstrap.value?.settings)
const tabs = computed(() => bootstrap.value ? buildTranslation2Tabs(bootstrap.value.settings, bootstrap.value.websites) : [])
const orderedWebsites = computed(() => workspace.value?.websiteOrder.flatMap(id => bootstrap.value?.websites.find(provider => provider.id === id) ?? []) ?? [])
const serviceGroups = computed(() => bootstrap.value ? buildTranslation2ServiceGroups(bootstrap.value.settings, bootstrap.value.aiProviders, bootstrap.value.machineConfigured) : [])
const importedServices = computed(() => workspace.value?.machineServices.filter(item => !item.builtIn) ?? [])
const definitionSummary = computed(() => {
  if (!importedDefinition.value || typeof importedDefinition.value !== 'object') return null
  const value = importedDefinition.value as Record<string, unknown>
  return {
    name: typeof value.name === 'string' ? value.name : '',
    endpoint: typeof value.endpoint === 'string' ? value.endpoint : '',
    auth: value.auth && typeof value.auth === 'object' && 'kind' in value.auth ? String((value.auth as Record<string, unknown>).kind) : '',
  }
})
const selectedServiceValue = computed({
  get: () => {
    const selected = workspace.value?.selectedService
    return selected ? selected.kind === 'ai' ? `ai:${selected.providerId}` : `machine:${selected.instanceId}` : ''
  },
  set: value => { void selectService(value) },
})
const selectedCatalogService = computed(() => {
  const selected = workspace.value?.selectedService
  if (!selected) return ''
  if (selected.kind === 'ai') return `ai:${selected.providerId}`
  const service = workspace.value?.machineServices.find(item => item.id === selected.instanceId)
  return service?.adapterId === 'deepl' ? 'deepl' : ''
})
const busy = computed(() => state.request !== null)
const activeTab = computed(() => workspace.value?.activeTab ?? { kind: 'webtools' as const })
const activeTabId = computed(() => activeTab.value.kind === 'webtools' ? 'webtools' : activeTab.value.providerId)
const canTranslate = computed(() => state.sourceText.trim().length > 0 && state.sourceText.length <= 20_000 && !busy.value)
const activeProviderLabel = computed(() => serviceGroups.value.flatMap(group => group.items).find(item => item.id === selectedServiceValue.value)?.label ?? '未选择服务')
const languages = TRANSLATION_LANGUAGES.map(item => ({ value: item.code, label: item.label }))

function replaceState(next: ReturnType<typeof createTranslation2ViewState>): void {
  Object.assign(state, next)
}

function invalidateResult(): void {
  if (autoTranslateTimer !== undefined) {
    window.clearTimeout(autoTranslateTimer)
    autoTranslateTimer = undefined
  }
  const request = state.request
  if (request) void window.translation2.cancel(request.id)
  state.request = null
  state.result = ''
  state.error = ''
  state.contentGeneration += 1
  copied.value = false
}

function translationSignature(): string {
  return JSON.stringify([
    state.openGeneration, state.contentGeneration, state.sourceText.trim(),
    sourceLanguage.value, targetLanguage.value, selectedServiceValue.value,
  ])
}

function scheduleAutoTranslate(): void {
  invalidateResult()
  if (activeTab.value.kind !== 'webtools' || !canTranslate.value) return
  const signature = translationSignature()
  autoTranslateTimer = window.setTimeout(() => {
    autoTranslateTimer = undefined
    if (signature !== translationSignature() || !canTranslate.value || signature === lastAutoTranslateSignature) return
    void translate(true)
  }, 500)
}

function publishWebsiteBounds(): void {
  if (serviceEditorOpen.value) return
  const element = websitePane.value
  if (!element || activeTab.value.kind !== 'website') return
  const rect = element.getBoundingClientRect()
  void window.translation2.setWebsiteBounds({
    x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)),
  })
}

async function selectTab(tab: Translation2TabSelection, force = false): Promise<void> {
  const nextId = tab.kind === 'webtools' ? 'webtools' : tab.providerId
  if (!workspace.value || !force && activeTabId.value === nextId && !tabSelectionPending) return
  invalidateResult()
  const revision = ++tabRevision
  tabSelectionPending = true
  const result = await window.translation2.selectTab({
    tab: { ...tab }, sourceText: state.sourceText, sourceLanguage: sourceLanguage.value, targetLanguage: targetLanguage.value, openGeneration: state.openGeneration,
  })
  if (revision !== tabRevision) return
  tabSelectionPending = false
  if (!result.ok) { state.error = result.error.message; return }
  applyWorkspace(result.data.settings)
  websiteSyncNotice.value = result.data.sourceSynchronized ? '' : '网站中的最新原文无法读取，已保留 WebTools 上次记录的原文。'
  if (result.data.sourceText !== state.sourceText) {
    state.sourceText = result.data.sourceText
    state.contentGeneration += 1
  }
  await nextTick()
  if (websitePane.value) websiteResizeObserver?.observe(websitePane.value)
  publishWebsiteBounds()
  if (tab.kind === 'webtools') scheduleAutoTranslate()
}

async function toggleWebsite(providerId: Translation2WebsiteProviderId, visible: boolean): Promise<void> {
  if (!visible && activeTab.value.kind === 'website' && activeTab.value.providerId === providerId) await selectTab({ kind: 'webtools' })
  return updateWorkspace(next => {
    next.visibleWebsiteIds = visible
      ? [...new Set([...next.visibleWebsiteIds, providerId])].sort((a, b) => next.websiteOrder.indexOf(a) - next.websiteOrder.indexOf(b))
      : next.visibleWebsiteIds.filter(id => id !== providerId)
  })
}

function startWebsiteDrag(event: DragEvent, providerId: Translation2WebsiteProviderId): void {
  draggingWebsiteId.value = providerId
  dropTargetWebsiteId.value = null
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', providerId)
}

function dragOverWebsite(event: DragEvent, providerId: Translation2WebsiteProviderId): void {
  if (!draggingWebsiteId.value) return
  if (draggingWebsiteId.value === providerId) {
    dropTargetWebsiteId.value = null
    dropAfterWebsite.value = false
    return
  }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTargetWebsiteId.value = providerId
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const bounds = target.getBoundingClientRect()
  dropAfterWebsite.value = target.classList.contains('provider-tab')
    ? event.clientX >= bounds.left + bounds.width / 2
    : event.clientY >= bounds.top + bounds.height / 2
}

function dropWebsite(event: DragEvent, targetId: Translation2WebsiteProviderId, visibleOnly: boolean): void {
  event.preventDefault()
  const requestedId = event.dataTransfer?.getData('text/plain') ?? ''
  const sourceId = workspace.value?.websiteOrder.find(id => id === requestedId) ?? draggingWebsiteId.value
  const target = event.currentTarget
  const bounds = target instanceof HTMLElement ? target.getBoundingClientRect() : null
  const horizontal = target instanceof HTMLElement && target.classList.contains('provider-tab')
  const after = bounds
    ? horizontal ? event.clientX >= bounds.left + bounds.width / 2 : event.clientY >= bounds.top + bounds.height / 2
    : false
  if (sourceId) void reorderWebsite(sourceId, targetId, after, visibleOnly)
  endWebsiteDrag()
}

function endWebsiteDrag(): void {
  draggingWebsiteId.value = null
  dropTargetWebsiteId.value = null
  dropAfterWebsite.value = false
}

function reorderWebsite(
  sourceId: Translation2WebsiteProviderId,
  targetId: Translation2WebsiteProviderId,
  after: boolean,
  visibleOnly: boolean,
): Promise<void> {
  if (sourceId === targetId) return Promise.resolve()
  return updateWorkspace(next => {
    const order = visibleOnly
      ? next.websiteOrder.filter(id => next.visibleWebsiteIds.includes(id))
      : [...next.websiteOrder]
    const sourceIndex = order.indexOf(sourceId)
    if (sourceIndex < 0 || !order.includes(targetId)) return
    order.splice(sourceIndex, 1)
    const targetIndex = order.indexOf(targetId)
    order.splice(targetIndex + Number(after), 0, sourceId)
    if (visibleOnly) {
      let visibleIndex = 0
      next.websiteOrder = next.websiteOrder.map(id => next.visibleWebsiteIds.includes(id) ? order[visibleIndex++] : id)
    } else {
      next.websiteOrder = order
    }
    next.visibleWebsiteIds.sort((left, right) => next.websiteOrder.indexOf(left) - next.websiteOrder.indexOf(right))
  })
}

function moveWebsiteByKeyboard(event: KeyboardEvent, providerId: Translation2WebsiteProviderId, visibleOnly: boolean): void {
  if (event.target !== event.currentTarget || !event.ctrlKey || !event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  const settings = workspace.value
  if (!settings) return
  const order = visibleOnly
    ? settings.websiteOrder.filter(id => settings.visibleWebsiteIds.includes(id))
    : settings.websiteOrder
  const index = order.indexOf(providerId)
  const direction = event.key === 'ArrowLeft' ? -1 : 1
  const targetId = order[index + direction]
  if (targetId) void reorderWebsite(providerId, targetId, direction > 0, visibleOnly)
}

function handleProviderTabKeydown(event: KeyboardEvent, tab: (typeof tabs.value)[number]): void {
  if (tab.kind === 'website' && event.ctrlKey && event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    moveWebsiteByKeyboard(event, tab.id as Translation2WebsiteProviderId, true)
    return
  }
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return
  const tablist = event.currentTarget instanceof HTMLElement ? event.currentTarget.parentElement : null
  const elements = Array.from(tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
  const index = elements.indexOf(event.currentTarget as HTMLButtonElement)
  if (index < 0 || elements.length < 2) return
  event.preventDefault()
  const direction = event.key === 'ArrowLeft' ? -1 : 1
  elements[(index + direction + elements.length) % elements.length]?.focus()
}

function updateWorkspace(change: (settings: Translation2WorkspaceSettings) => void): Promise<void> {
  const operation = settingsWrite.then(async () => {
    if (!workspace.value) return
    const next = structuredClone(toRaw(workspace.value))
    change(next)
    const result = await window.translation2.updateSettings(next)
    if (!result.ok) { state.error = result.error.message; return }
    applyWorkspace(result.data)
  }).catch(() => { state.error = '设置未能保存，请重试。' })
  settingsWrite = operation
  return operation
}

function applyWorkspace(settings: Translation2WorkspaceSettings, configured?: Record<string, boolean>): void {
  if (!bootstrap.value) return
  bootstrap.value = {
    ...bootstrap.value,
    settings,
    machineConfigured: configured ?? bootstrap.value.machineConfigured,
  }
}

async function selectService(value: string): Promise<void> {
  let selected: Translation2ServiceSelection | null = null
  if (value.startsWith('machine:')) selected = { kind: 'machine', instanceId: value.slice('machine:'.length) }
  if (value.startsWith('ai:')) {
    const providerId = value.slice('ai:'.length)
    if (isAIProviderId(providerId)) selected = { kind: 'ai', providerId }
  }
  if (!selected) return
  await updateWorkspace(next => { next.selectedService = selected! })
  scheduleAutoTranslate()
}

async function translate(automatic = false): Promise<void> {
  if (autoTranslateTimer !== undefined) {
    window.clearTimeout(autoTranslateTimer)
    autoTranslateTimer = undefined
  }
  if (!canTranslate.value) return
  const signature = translationSignature()
  if (automatic && signature === lastAutoTranslateSignature) return
  if (automatic) lastAutoTranslateSignature = signature
  const token = { id: crypto.randomUUID(), contentGeneration: state.contentGeneration }
  state.request = token
  state.result = ''
  state.error = ''
  let result: Awaited<ReturnType<typeof window.translation2.translate>>
  try {
    result = await window.translation2.translate({
      requestId: token.id,
      text: state.sourceText,
      sourceLanguage: sourceLanguage.value,
      targetLanguage: targetLanguage.value,
    })
  } catch {
    if (!isTranslation2RequestCurrent(state, token)) return
    state.request = null
    state.error = '翻译请求未完成，请检查网络和当前服务配置后重试。'
    return
  }
  if (!isTranslation2RequestCurrent(state, token)) return
  state.request = null
  if (result.ok) state.result = result.data.translation
  else state.error = result.error.message
}

async function cancel(): Promise<void> {
  const request = state.request
  if (!request) return
  state.request = null
  await window.translation2.cancel(request.id)
}

function sourceChanged(): void { scheduleAutoTranslate() }
function languageChanged(): void { scheduleAutoTranslate() }
function swapLanguages(): void {
  if (sourceLanguage.value === 'auto') return
  const source = sourceLanguage.value
  sourceLanguage.value = targetLanguage.value
  targetLanguage.value = source
  scheduleAutoTranslate()
}

async function copyResult(): Promise<void> {
  if (!state.result) return
  await navigator.clipboard.writeText(state.result)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1200)
}

async function restoreDefaults(): Promise<void> {
  await settingsWrite
  if (activeTab.value.kind === 'website') await selectTab({ kind: 'webtools' })
  const result = await window.translation2.restoreDefaults()
  if (!result.ok) { state.error = result.error.message; return }
  applyWorkspace(result.data)
  scheduleAutoTranslate()
}

async function chooseDefinition(event: Event): Promise<void> {
  importedMessage.value = ''
  importedTested.value = false
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 64 * 1024) { importedMessage.value = '定义文件超过 64 KiB。'; return }
  try {
    importedDefinition.value = parseTranslation2ImportedApiDefinition(JSON.parse(await file.text()))
    if (!importedDefinition.value) { importedMessage.value = '定义格式不支持或包含明文凭据。请将 API Key 从定义中移除，并填写在独立密钥输入框。'; return }
    importedFileName.value = file.name
    const value = importedDefinition.value as Record<string, unknown>
    importedName.value = typeof value.name === 'string' ? value.name : ''
  } catch { importedDefinition.value = null; importedMessage.value = '定义文件不是有效 JSON。' }
  ;(event.target as HTMLInputElement).value = ''
}

async function testImportedDraft(): Promise<void> {
  if (!importedDefinition.value) return
  importedMessage.value = '正在使用无敏感测试文本测试服务…'
  const result = await window.translation2.testImportedDraft({ definition: structuredClone(toRaw(importedDefinition.value)), secret: importedSecret.value })
  importedTested.value = result.ok
  importedMessage.value = result.ok ? '连接测试通过。' : result.error.message
}

async function saveImported(): Promise<void> {
  if (!importedDefinition.value || !importedTested.value) return
  const result = await window.translation2.saveImported({ definition: structuredClone(toRaw(importedDefinition.value)), name: importedName.value, secret: importedSecret.value })
  if (!result.ok) { importedMessage.value = result.error.message; return }
  const selected = result.data.selectedService
  const configured = { ...(bootstrap.value?.machineConfigured ?? {}) }
  if (selected.kind === 'machine') configured[selected.instanceId] = true
  applyWorkspace(result.data, configured)
  importedDefinition.value = null
  importedFileName.value = ''
  importedName.value = ''
  importedSecret.value = ''
  importedTested.value = false
  importedMessage.value = '翻译服务已保存并选中。'
  scheduleAutoTranslate()
}

async function testImported(instanceId: string): Promise<void> {
  importedMessage.value = '正在测试已保存的服务…'
  const result = await window.translation2.testImported(instanceId)
  if (!result.ok) { importedMessage.value = result.error.message; return }
  applyWorkspace(result.data.settings)
  importedMessage.value = '连接测试通过。'
}

async function toggleImported(instanceId: string, enabled: boolean): Promise<void> {
  const result = await window.translation2.updateImported(instanceId, { enabled })
  if (!result.ok) { importedMessage.value = result.error.message; return }
  applyWorkspace(result.data)
  scheduleAutoTranslate()
}

function beginEditImported(instanceId: string, name: string): void {
  editingServiceId.value = instanceId
  editingName.value = name
  editingSecret.value = ''
  editingSecretVisible.value = false
}

async function saveImportedEdit(): Promise<void> {
  if (!editingServiceId.value) return
  const input: { name: string; secret?: string } = { name: editingName.value }
  if (editingSecret.value) input.secret = editingSecret.value
  const result = await window.translation2.updateImported(editingServiceId.value, input)
  if (!result.ok) { importedMessage.value = result.error.message; return }
  applyWorkspace(result.data)
  editingServiceId.value = ''
  editingSecret.value = ''
  await serviceSaved(null)
  importedMessage.value = '服务信息已更新，请重新测试。'
}

async function deleteImported(instanceId: string): Promise<void> {
  const result = await window.translation2.deleteImported(instanceId)
  if (!result.ok) { importedMessage.value = result.error.message; return }
  const configured = { ...(bootstrap.value?.machineConfigured ?? {}) }
  delete configured[instanceId]
  applyWorkspace(result.data, configured)
  importedMessage.value = '翻译服务已删除。'
  scheduleAutoTranslate()
}

function closeWindow(): void { void window.translation2.close() }
async function togglePinned(): Promise<void> {
  const result = await window.translation2.setPinned(!pinned.value)
  if (result.ok) pinned.value = result.data.pinned
  else state.error = result.error.message
}
async function minimizeWindow(): Promise<void> {
  const result = await window.translation2.minimize()
  if (!result.ok) state.error = result.error.message
}

function editService(): void {
  serviceEditorOpen.value = true
  if (activeTab.value.kind === 'website') void window.translation2.setWebsiteBounds({ x: 0, y: 0, width: 1, height: 1 })
}
async function serviceSaved(provider: AIProviderId | null): Promise<void> {
  if (provider) await selectService(`ai:${provider}`)
  const result = await window.translation2.bootstrap()
  if (result.ok) bootstrap.value = result.data
  else state.error = result.error.message
  if (!provider) scheduleAutoTranslate()
}
async function closeServiceEditor(): Promise<void> { serviceEditorOpen.value = false; await nextTick(); publishWebsiteBounds() }

async function loadBootstrap(): Promise<void> {
  const result = await window.translation2.bootstrap()
  loadingBootstrap.value = false
  if (!result.ok) { fatalError.value = result.error.message; return }
  bootstrap.value = result.data
  pinned.value = result.data.pinned
  sourceLanguage.value = result.data.languageDefaults.sourceLanguage
  targetLanguage.value = result.data.languageDefaults.targetLanguage
  replaceState(createTranslation2ViewState(result.data.open))
  if (result.data.settings.activeTab.kind === 'website') {
    const tab = result.data.settings.activeTab
    await nextTick()
    const selected = await window.translation2.selectTab({ tab, sourceText: state.sourceText, sourceLanguage: sourceLanguage.value, targetLanguage: targetLanguage.value, openGeneration: state.openGeneration })
    if (!selected.ok) { state.error = selected.error.message; return }
    applyWorkspace(selected.data.settings)
    state.sourceText = selected.data.sourceText
    websiteSyncNotice.value = selected.data.sourceSynchronized ? '' : '网站中的最新原文无法读取，已保留 WebTools 上次记录的原文。'
    publishWebsiteBounds()
  } else scheduleAutoTranslate()
}

onMounted(() => {
  removeWebsiteState = window.translation2.onWebsiteState?.(value => { websiteStatus.value = value })
  websiteResizeObserver = new ResizeObserver(publishWebsiteBounds)
  if (websitePane.value) websiteResizeObserver.observe(websitePane.value)
  removeOpened = window.translation2.onOpened(open => {
    const previous = state.request
    const next = applyTranslation2Open(state, open)
    if (next === state) return
    if (previous) void window.translation2.cancel(previous.id)
    replaceState(next)
    if (activeTab.value.kind === 'website') void selectTab(activeTab.value, true)
    else scheduleAutoTranslate()
  })
  if (!bootstrap.value) void loadBootstrap()
  else if (bootstrap.value.settings.activeTab.kind === 'website') void selectTab(bootstrap.value.settings.activeTab, true)
  else scheduleAutoTranslate()
})
watch(websitePane, (next, previous) => { if (previous) websiteResizeObserver?.unobserve(previous); if (next) websiteResizeObserver?.observe(next) })
onBeforeUnmount(() => { ++tabRevision; if (autoTranslateTimer !== undefined) window.clearTimeout(autoTranslateTimer); removeWebsiteState?.(); removeOpened?.(); websiteResizeObserver?.disconnect(); if (state.request) void window.translation2.cancel(state.request.id) })
</script>

<template>
  <div class="translation-shell">
    <header class="provider-bar">
      <nav class="provider-tabs" role="tablist" aria-label="翻译提供方" aria-orientation="horizontal">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="provider-tab"
          :class="{ active: tab.id === activeTabId, dragging: tab.kind === 'website' && draggingWebsiteId === tab.id, 'drop-target': tab.kind === 'website' && dropTargetWebsiteId === tab.id, 'drop-after': tab.kind === 'website' && dropTargetWebsiteId === tab.id && dropAfterWebsite }"
          :aria-label="tab.kind === 'website' ? `${tab.label}，可拖动排序` : tab.label"
          :aria-selected="tab.id === activeTabId"
          :tabindex="tab.id === activeTabId ? 0 : -1"
          aria-controls="translation-provider-panel"
          :draggable="tab.kind === 'website'"
          @click="selectTab(tab.kind === 'webtools' ? { kind: 'webtools' } : { kind: 'website', providerId: tab.id as Translation2WebsiteProviderId })"
          @keydown="handleProviderTabKeydown($event, tab)"
          @dragstart="tab.kind === 'website' && startWebsiteDrag($event, tab.id as Translation2WebsiteProviderId)"
          @dragover="tab.kind === 'website' && dragOverWebsite($event, tab.id as Translation2WebsiteProviderId)"
          @drop="tab.kind === 'website' && dropWebsite($event, tab.id as Translation2WebsiteProviderId, true)"
          @dragend="endWebsiteDrag"
        >
          <span>{{ tab.label }}</span>
        </button>
      </nav>
      <button class="icon-button" type="button" aria-label="翻译服务设置" @click="settingsOpen = !settingsOpen"><Settings2 :size="18" /></button>
      <button class="icon-button" :class="{ 'is-pinned': pinned }" type="button" :aria-label="pinned ? '取消置顶' : '置顶翻译窗口'" :aria-pressed="pinned" @click="togglePinned"><Pin :size="17" /></button>
      <button class="icon-button" type="button" aria-label="最小化翻译窗口" @click="minimizeWindow"><Minus :size="18" /></button>
      <button class="icon-button" type="button" aria-label="关闭翻译" @click="closeWindow"><X :size="19" /></button>
    </header>

    <main v-if="bootstrap" class="workspace">
      <section v-if="activeTab.kind === 'webtools'" id="translation-provider-panel" class="native-pane" role="tabpanel" tabindex="0" aria-label="WebTools 翻译">
        <div class="toolbar">
          <select v-model="sourceLanguage" aria-label="原文语言" @change="languageChanged"><option value="auto">自动识别</option><option v-for="language in languages" :key="language.value" :value="language.value">{{ language.label }}</option></select>
          <button class="swap" type="button" :disabled="sourceLanguage === 'auto'" aria-label="交换语言" @click="swapLanguages">⇄</button>
          <select v-model="targetLanguage" aria-label="译文语言" @change="languageChanged"><option v-for="language in languages" :key="language.value" :value="language.value">{{ language.label }}</option></select>
          <select v-model="selectedServiceValue" class="service-select" aria-label="翻译服务">
            <optgroup v-for="group in serviceGroups" :key="group.kind" :label="group.label">
              <option v-for="item in group.items" :key="item.id" :value="item.id" :disabled="!item.configured">{{ item.label }}{{ item.configured ? '' : '（未配置）' }}</option>
            </optgroup>
          </select>
        </div>

        <div class="editor-grid">
          <label class="editor-card"><span>原文</span><textarea v-model="state.sourceText" maxlength="20000" placeholder="输入或粘贴要翻译的文字" @input="sourceChanged" /></label>
          <section class="editor-card result-card" aria-live="polite"><div class="card-title"><span>译文</span><button v-if="state.result" class="text-button" type="button" @click="copyResult"><Check v-if="copied" :size="14" /><Copy v-else :size="14" />{{ copied ? '已复制' : '复制' }}</button></div><div class="result-text" :class="{ muted: !state.result }">{{ state.result || (busy ? '正在翻译…' : '译文会显示在这里') }}</div></section>
        </div>

        <footer class="actions">
          <span class="provider-note">{{ activeProviderLabel }} · 停止输入约 0.5 秒后自动翻译</span>
          <button v-if="busy" class="secondary" type="button" @click="cancel">取消</button>
          <button class="primary" type="button" :disabled="!canTranslate" @click="translate()">{{ busy ? '正在翻译…' : '翻译' }}</button>
        </footer>
        <p v-if="websiteSyncNotice" class="notice" role="status">{{ websiteSyncNotice }}</p>
        <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>
      </section>
      <section v-else id="translation-provider-panel" ref="websitePane" class="website-pane" role="tabpanel" tabindex="0" :aria-label="`${tabs.find(tab => tab.id === activeTabId)?.label ?? '网站'}翻译内容`"><div v-if="websiteStatus?.providerId === activeTabId && websiteStatus.phase === 'error'" role="alert"><p>{{ websiteStatus.message }}</p><button class="secondary" type="button" @click="selectTab(activeTab, true)">重新载入</button></div><span v-else>正在载入 {{ tabs.find(tab => tab.id === activeTabId)?.label }}…</span></section>

      <aside v-if="settingsOpen" class="service-panel">
        <div class="panel-heading"><div><strong>翻译服务</strong><p>网站、机器翻译 API 与 AI 服务保持独立。</p></div><button class="icon-button" type="button" aria-label="关闭设置" @click="settingsOpen = false"><X :size="17" /></button></div>
        <button class="secondary" type="button" @click="editService()">＋ 添加翻译服务</button>
        <section v-for="group in serviceGroups.filter(group => group.kind !== 'ai')" :key="group.kind" class="service-group"><h2>{{ group.label }}</h2><div v-for="item in group.items" :key="item.id" class="service-row"><div><strong>{{ item.label }}</strong><small>{{ item.configured ? '配置齐备，连接状态以测试结果为准' : '需要配置' }}</small></div><div class="row-actions"><button v-if="item.configured" class="mini-button" type="button" :disabled="selectedServiceValue === item.id" @click="selectService(item.id)">{{ selectedServiceValue === item.id ? '当前选择' : '使用' }}</button></div></div></section>
        <section class="service-group">
          <div class="group-title"><h2>自定义机器翻译服务</h2></div>
          <details><summary>高级：导入 JSON 接口定义</summary><button class="mini-button" type="button" @click="importFile?.click()"><FileUp :size="14" />选择定义文件</button>
          <input ref="importFile" class="visually-hidden" type="file" accept="application/json,.json" @change="chooseDefinition">
          <div v-if="definitionSummary" class="import-card">
            <strong>{{ definitionSummary.name || importedFileName }}</strong>
            <code>{{ definitionSummary.endpoint }}</code>
            <small>认证：{{ definitionSummary.auth || '待验证' }}。定义只描述数据映射，不执行脚本。</small>
            <input v-model="importedName" maxlength="80" placeholder="服务名称，例如 DeepL 1">
            <div class="secret-field"><input v-model="importedSecret" maxlength="4096" :type="importedSecretVisible ? 'text' : 'password'" autocomplete="new-password" placeholder="API 凭据（无认证定义可留空）"><button class="mini-button icon-only" type="button" :aria-label="importedSecretVisible ? '隐藏凭据' : '显示凭据'" @click="importedSecretVisible = !importedSecretVisible"><EyeOff v-if="importedSecretVisible" :size="14" /><Eye v-else :size="14" /></button></div>
            <div class="row-actions"><button class="mini-button" type="button" @click="testImportedDraft"><Play :size="14" />测试</button><button class="mini-button primary-inline" type="button" :disabled="!importedTested" @click="saveImported">保存并选中</button></div>
          </div>
          </details>
          <div v-for="service in importedServices" :key="service.id" class="managed-service">
            <template v-if="editingServiceId === service.id">
              <input v-model="editingName" maxlength="80" aria-label="服务名称">
              <div class="secret-field"><input v-model="editingSecret" maxlength="4096" :type="editingSecretVisible ? 'text' : 'password'" autocomplete="new-password" placeholder="新凭据（留空则不更改）"><button class="mini-button icon-only" type="button" :aria-label="editingSecretVisible ? '隐藏凭据' : '显示凭据'" @click="editingSecretVisible = !editingSecretVisible"><EyeOff v-if="editingSecretVisible" :size="14" /><Eye v-else :size="14" /></button></div>
              <div class="row-actions"><button class="mini-button" type="button" @click="saveImportedEdit">保存</button><button class="mini-button" type="button" @click="editingServiceId = ''">取消</button></div>
            </template>
            <template v-else>
              <div class="service-row"><div><strong>{{ service.name }}</strong><small>{{ service.testStatus === 'passed' ? '测试通过' : service.testStatus === 'failed' ? '测试失败' : '尚未测试' }}</small></div><span :class="bootstrap.machineConfigured[service.id] ? 'status-ready' : 'status-missing'">{{ selectedServiceValue === `machine:${service.id}` ? '当前默认' : bootstrap.machineConfigured[service.id] ? (service.enabled ? '已显示' : '已隐藏') : '缺少凭据' }}</span></div>
              <div class="row-actions"><button class="mini-button" type="button" @click="testImported(service.id)"><Play :size="14" />测试</button><button class="mini-button" type="button" :disabled="selectedServiceValue === `machine:${service.id}`" @click="selectService(`machine:${service.id}`)">设为默认</button><button class="mini-button" type="button" @click="toggleImported(service.id, !service.enabled)">{{ service.enabled ? '隐藏' : '显示' }}</button><button class="mini-button" type="button" @click="beginEditImported(service.id, service.name)"><Pencil :size="14" />编辑</button><button class="mini-button danger-inline" type="button" @click="deleteImported(service.id)"><Trash2 :size="14" />删除</button></div>
            </template>
          </div>
          <p v-if="importedMessage" class="import-message" role="status">{{ importedMessage }}</p>
        </section>
        <section class="service-group"><h2>网站翻译</h2><p class="empty-note">在独立标签中使用服务商网页。网站的可访问性与响应速度取决于网络和服务商；自动填入失败时可以在网页内输入。拖动服务项或上方标签可调整顺序；聚焦服务项后按 Ctrl+Shift+←/→ 也可微调。开关控制是否显示对应标签。</p><div
          v-for="provider in orderedWebsites"
          :key="provider.id"
          class="service-row website-setting"
          :class="{ dragging: draggingWebsiteId === provider.id, 'drop-target': dropTargetWebsiteId === provider.id, 'drop-after': dropTargetWebsiteId === provider.id && dropAfterWebsite }"
          role="group"
          tabindex="0"
          :aria-label="`${provider.name}翻译服务，可拖动或使用 Ctrl+Shift+左右调整顺序`"
          draggable="true"
          @keydown="moveWebsiteByKeyboard($event, provider.id, false)"
          @dragstart="startWebsiteDrag($event, provider.id)"
          @dragover="dragOverWebsite($event, provider.id)"
          @drop="dropWebsite($event, provider.id, false)"
          @dragend="endWebsiteDrag"
        ><div class="website-setting-name"><GripVertical :size="15" class="website-setting-grip" aria-hidden="true" /><strong>{{ provider.name }}</strong></div><label class="visibility-switch"><input type="checkbox" role="switch" :checked="workspace?.visibleWebsiteIds.includes(provider.id) ?? false" :aria-label="`${provider.name}翻译标签`" @change="toggleWebsite(provider.id, ($event.target as HTMLInputElement).checked)"><span class="visibility-switch-track" aria-hidden="true"></span></label></div></section>
        <button class="secondary restore" type="button" @click="restoreDefaults"><RotateCcw :size="15" />恢复默认显示与选择</button>
      </aside>
    </main>
    <main v-else class="load-state" :role="fatalError ? 'alert' : 'status'">{{ fatalError || (loadingBootstrap ? '正在载入 Translation 2.0…' : 'Translation 2.0 暂不可用。') }}</main>
    <TranslationServiceEditor v-if="serviceEditorOpen && bootstrap" :selected-service="selectedCatalogService" :providers="bootstrap.aiProviders" @saved="serviceSaved" @close="closeServiceEditor" />
  </div>
</template>

<style scoped>
:global(*) { box-sizing: border-box; }
:global(html), :global(body), :global(#app) { width: 100%; height: 100%; margin: 0; overflow: hidden; }
:global(body) { color: var(--text); background: var(--bg); font-family: Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif; }
button, select, textarea { font: inherit; }
.translation-shell { display: flex; width: 100%; height: 100%; flex-direction: column; background: var(--bg); }
.provider-bar { display: flex; height: 64px; min-height: 64px; flex: 0 0 64px; align-items: center; gap: 8px; padding: 0 clamp(14px, 2vw, 24px); border-bottom: 1px solid var(--line); background: var(--sidebar); }
.brand { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; padding-right: 10px; color: var(--text); }
.provider-bar { -webkit-app-region: drag; app-region: drag; }
.provider-tab, .provider-bar > .icon-button { -webkit-app-region: no-drag; app-region: no-drag; }
.provider-bar > .icon-button.is-pinned { color: var(--accent); background: var(--accent-soft); }
.provider-tabs { display: flex; min-width: 0; flex: 1 1 0; align-self: stretch; align-items: stretch; gap: 2px; overflow-x: auto; overflow-y: hidden; padding-top: 7px; scrollbar-width: none; }
.provider-tabs::-webkit-scrollbar { display: none; }
.service-panel::-webkit-scrollbar { height: 5px; width: 5px; }
.service-panel::-webkit-scrollbar-thumb { border-radius: 999px; background: var(--line); }
.service-panel::-webkit-scrollbar-track { background: transparent; }
.provider-tab { display: inline-flex; flex: 0 0 auto; min-width: max-content; align-items: center; justify-content: center; margin-bottom: -1px; padding: 0 clamp(14px, 1.6vw, 20px); border: 1px solid transparent; border-bottom: 0; border-radius: 10px 10px 0 0; color: var(--muted); background: var(--surface-raised); cursor: grab; user-select: none; white-space: nowrap; }
.provider-tab[draggable="false"] { cursor: pointer; }
.provider-tab:active { cursor: grabbing; }
.provider-tab.active { z-index: 1; border-color: var(--line); border-bottom-color: var(--surface); color: var(--text); background: var(--surface); font-weight: 650; }
.provider-tab.dragging { opacity: .48; }
.provider-tab.drop-target { box-shadow: inset 2px 0 var(--accent); }
.provider-tab.drop-target.drop-after { box-shadow: inset -2px 0 var(--accent); }
.provider-tab:focus-visible, .website-setting:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.icon-button { display: inline-grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; border: 1px solid var(--border); border-radius: 9px; color: var(--text); background: var(--surface-elevated); cursor: pointer; }
.provider-bar > .icon-button { flex: 0 0 34px; align-self: center; }
.workspace { display: flex; min-height: 0; flex: 1; }
.native-pane { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 14px; padding: clamp(16px, 2.4vw, 30px); }
.website-pane { display: grid; min-width: 0; flex: 1; place-items: center; color: var(--muted); background: var(--bg); }
.toolbar { display: grid; grid-template-columns: minmax(120px, .7fr) 38px minmax(120px, .7fr) minmax(220px, 1.3fr); gap: 8px; }
select, .swap { min-height: 38px; border: 1px solid var(--border); border-radius: 9px; color: var(--text); background: var(--surface); padding: 0 10px; }
.swap { padding: 0; cursor: pointer; }
.editor-grid { display: grid; min-height: 0; flex: 1; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.editor-card { display: flex; min-height: 240px; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.editor-card > span, .card-title { color: var(--muted); font-size: 13px; }
.card-title { display: flex; align-items: center; justify-content: space-between; }
textarea { width: 100%; min-height: 0; flex: 1; resize: none; border: 0; outline: 0; color: var(--text); background: transparent; font-size: clamp(15px, 1.45vw, 19px); line-height: 1.75; }
.result-text { min-height: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: clamp(15px, 1.45vw, 19px); line-height: 1.75; scrollbar-width: thin; }
.muted { color: var(--muted); }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; }
.provider-note { min-width: 0; flex: 1; overflow: hidden; color: var(--muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.primary, .secondary { min-height: 38px; padding: 0 16px; border-radius: 9px; cursor: pointer; }
.primary { border: 1px solid var(--accent); color: white; background: var(--accent); }
.primary:disabled { cursor: default; opacity: .45; }
.secondary { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--border); color: var(--text); background: var(--surface); }
.text-button { display: inline-flex; align-items: center; gap: 5px; border: 0; color: var(--accent); background: transparent; cursor: pointer; }
.error { margin: 0; color: var(--danger, #d95f59); font-size: 13px; }
.notice { margin: 0; color: var(--muted); font-size: 13px; }
.service-panel { width: clamp(280px, 31vw, 390px); overflow: auto; padding: 20px; border-left: 1px solid var(--line); background: var(--surface); scrollbar-color: var(--line) transparent; scrollbar-width: thin; }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
.panel-heading p, .empty-note { margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.service-group { padding: 16px 0; border-bottom: 1px solid var(--border); }
.service-group h2 { margin: 0 0 10px; font-size: 13px; }
.group-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.group-title h2 { margin: 0; }
.service-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; }
.service-row div { display: grid; min-width: 0; gap: 3px; }
.service-row strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.service-row small { color: var(--muted); }
.status-ready, .status-missing { flex: 0 0 auto; font-size: 11px; }
.status-ready { color: #52a879; }.status-missing { color: var(--muted); }
.restore { margin-top: 18px; }
.visually-hidden { position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.import-card, .managed-service { display: grid; gap: 8px; margin-top: 10px; padding: 11px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); }
.import-card code { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.import-card small, .import-message { color: var(--muted); font-size: 11px; line-height: 1.5; }
.import-card input, .managed-service input { min-height: 34px; padding: 0 9px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); background: var(--surface); }
.secret-field { display: flex; gap: 6px; }.secret-field input { min-width: 0; flex: 1; }
.row-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.mini-button { display: inline-flex; min-height: 30px; align-items: center; gap: 5px; padding: 0 9px; border: 1px solid var(--border); border-radius: 7px; color: var(--text); background: var(--surface); cursor: pointer; }
.mini-button:disabled { cursor: default; opacity: .45; }
.icon-only { width: 30px; padding: 0; justify-content: center; }
.website-setting { min-height: 43px; margin-top: 6px; padding: 8px 10px; border: 1px solid transparent; border-radius: 8px; background: var(--bg); cursor: grab; user-select: none; }
.website-setting:active { cursor: grabbing; }
.website-setting.dragging { opacity: .48; }
.website-setting.drop-target { border-top-color: var(--accent); box-shadow: inset 0 2px var(--accent); }
.website-setting.drop-target.drop-after { border-top-color: transparent; border-bottom-color: var(--accent); box-shadow: inset 0 -2px var(--accent); }
.service-row .website-setting-name { display: flex; align-items: center; gap: 8px; }
.website-setting-grip { flex: 0 0 auto; color: var(--muted); }
.visibility-switch { position: relative; display: inline-flex; width: 40px; height: 22px; flex: 0 0 auto; cursor: pointer; }
.visibility-switch input { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.visibility-switch-track { position: relative; display: block; width: 40px; height: 22px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-elevated); transition: border-color .16s ease, background-color .16s ease; }
.visibility-switch-track::after { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted); content: ""; transition: transform .16s ease, background-color .16s ease; }
.visibility-switch input:checked + .visibility-switch-track { border-color: var(--accent); background: var(--accent); }
.visibility-switch input:checked + .visibility-switch-track::after { transform: translateX(18px); background: white; }
.visibility-switch input:focus-visible + .visibility-switch-track { outline: 2px solid var(--accent); outline-offset: 2px; }
.primary-inline { color: white; border-color: var(--accent); background: var(--accent); }
.danger-inline { color: var(--danger, #d95f59); }
.load-state { display: grid; flex: 1; place-items: center; color: var(--muted); }
@media (max-width: 760px) { .toolbar { grid-template-columns: 1fr 38px 1fr; }.service-select { grid-column: 1 / -1; }.editor-grid { grid-template-columns: 1fr; overflow: auto; }.editor-card { min-height: 220px; }.service-panel { position: absolute; inset: 58px 0 0 auto; width: min(390px, 88vw); box-shadow: -16px 0 34px rgb(0 0 0 / .22); }.brand strong { display: none; } }
</style>
