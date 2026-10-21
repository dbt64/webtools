<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, ExternalLink, Languages, LayoutGrid, PackagePlus, Puzzle, RefreshCw, Search, ShieldCheck } from '@lucide/vue'
import type { InstalledPluginCapability as PluginCapability, PluginSummary } from '../../shared/plugin-contracts.ts'
import type { BuiltinEntryDTO, CatalogEntryDTO, PluginRef } from '../../shared/plugin-catalog-contracts.ts'
import { catalogFeatureRows, catalogFeatureSummary, catalogKey, catalogRef, catalogPresentation } from './catalog-view-model.ts'
import { pluginCanOpen, pluginGrantPayload, pluginInstallFeedback, pluginManagementError, pluginPermissionRows, pluginStatusView } from './plugin-view-model.ts'
import PluginDevelopmentPanel from './PluginDevelopmentPanel.vue'
import PluginConfigurationEditor from './PluginConfigurationEditor.vue'

const props = defineProps<{ entries: CatalogEntryDTO[]; selection?: PluginRef | null; loading: boolean; error?: string; runtimeError?: { pluginId?: string; code: string } | null }>()
const emit = defineEmits<{ changed: []; retry: []; openPlugin: [ref: PluginRef]; selectPlugin: [ref: PluginRef | null]; openSettings: [] }>()

const selectedRef = ref<PluginRef | null>(null)
const searchQuery = ref('')
const selected = computed(() => selectedRef.value ? props.entries.find(entry => catalogKey(entry) === catalogKey(selectedRef.value!)) ?? null : null)
const selectedPackage = computed(() => selected.value && selected.value.kind !== 'builtin' ? selected.value.package : null)
const selectedBuiltin = computed(() => selected.value?.kind === 'builtin' ? selected.value : null)
const overviewEntries = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  return props.entries.filter(entry => !query || [catalogPresentation(entry).name, catalogPresentation(entry).description, catalogFeatureSummary(entry)].join(' ').toLocaleLowerCase().includes(query))
})
const grantedDraft = ref<PluginCapability[]>([])
const busy = ref<string | null>(null)
const configurationBusy = ref(false)
const configurationDirty = ref(false)
const configurationEditor = ref<{ confirmLeave(): boolean } | null>(null)
const feedback = ref<{ kind: 'status' | 'error'; text: string } | null>(null)
const developerExpanded = ref(false)
const managementMenuOpen = ref(false)
const actionRoot = ref<HTMLElement | null>(null)
const managementMenuTrigger = ref<HTMLButtonElement | null>(null)
const managementMenu = ref<HTMLElement | null>(null)
const permissionRows = computed(() => selectedPackage.value ? pluginPermissionRows(selectedPackage.value) : [])
const operationsDisabled = computed(() => props.loading || Boolean(busy.value) || configurationBusy.value)
const features = computed(() => selected.value ? catalogFeatureRows(selected.value) : [])
const selectedEnabled = computed(() => selectedBuiltin.value?.state.enabled ?? selectedPackage.value?.enabled ?? false)
const primaryFeature = computed(() => features.value.find(feature => feature.available) ?? null)
const compatibilityCanOpen = computed(() => selectedPackage.value && (selectedPackage.value.manifestVersion === 1 || selectedPackage.value.manifestVersion === undefined) && pluginCanOpen(selectedPackage.value))
const hasLegacyConfiguration = computed(() => selected.value?.kind === 'declarative' && selectedPackage.value?.requested.some(cap => cap === 'plugin.config.read' || cap === 'plugin.config.write'))
const permissionsChanged = computed(() => selectedPackage.value && JSON.stringify(grantedDraft.value.slice().sort()) !== JSON.stringify(selectedPackage.value.granted.filter(cap => cap !== 'network.domains').sort()))
const healthCode = computed(() => {
  if (selectedPackage.value?.errorCode) return selectedPackage.value.errorCode
  const state = selectedBuiltin.value?.state
  return state && (state.status === 'faulted' || state.status === 'unavailable') ? state.errorCode : undefined
})
const healthDescription = computed(() => {
  if (healthCode.value) return pluginManagementError({ code: healthCode.value })
  if (selectedPackage.value) return pluginStatusView(selectedPackage.value).recovery || '插件已启用，功能可以按需使用。启用不代表正在后台常驻运行。'
  return selectedEnabled.value ? '内置翻译可用。打开后使用独立的 Translation 2.0 窗口。' : '内置翻译已停用；原有设置和密钥仍然保留。'
})
type PrimaryAction = 'open' | 'run' | 'enable' | 'retry' | 'recover' | 'permissions' | 'health' | 'unavailable'
type ManagementAction = 'toggle' | 'stop' | 'replace' | 'uninstall' | 'recover'
const primaryAction = computed<PrimaryAction>(() => {
  const entry = selected.value
  if (!entry) return 'unavailable'
  if (entry.kind === 'builtin') {
    if (entry.state.status === 'ready' && entry.state.enabled) return 'open'
    if (entry.state.status === 'disabled' && entry.management.canToggle) return 'enable'
    if (entry.state.status === 'faulted') {
      if (entry.management.canToggle) return 'retry'
      if (entry.management.canRecover) return 'recover'
    }
    if (entry.state.status === 'unavailable' && entry.management.canRecover) return 'recover'
    return 'unavailable'
  }
  if (entry.package.status === 'installed-disabled') return entry.management.canToggle ? 'enable' : 'unavailable'
  if (entry.package.status === 'needs-permission') return 'permissions'
  if (entry.package.status === 'faulted' || entry.package.status === 'invalid' || entry.package.status === 'incompatible') return 'health'
  if (!entry.package.enabled) return 'unavailable'
  if (entry.kind === 'web' && primaryFeature.value) return primaryFeature.value.actionKind === 'command' ? 'run' : 'open'
  if (entry.kind === 'declarative' && compatibilityCanOpen.value) return 'open'
  return 'unavailable'
})
const primaryActionLabel = computed(() => {
  if (primaryAction.value === 'retry' && selectedBuiltin.value?.state.status === 'faulted') {
    return selectedBuiltin.value.state.retryEnabled ? '重试启用' : '重试停用'
  }
  if (selectedBuiltin.value?.state.status === 'enabling') return '正在启用…'
  if (selectedBuiltin.value?.state.status === 'stopping') return '正在停用…'
  return ({
    open: '打开', run: '运行', enable: '启用', retry: '重试', recover: '备份并恢复状态',
    permissions: '查看权限', health: '查看状态', unavailable: selected.value ? '暂不可用' : '选择插件',
  }[primaryAction.value])
})
const primaryActionDisabled = computed(() => operationsDisabled.value || primaryAction.value === 'unavailable')
const managementActions = computed(() => {
  const entry = selected.value
  if (!entry) return [] as { id: ManagementAction; label: string; danger?: boolean }[]
  const actions: { id: ManagementAction; label: string; danger?: boolean }[] = []
  if (entry.kind === 'builtin') {
    const toggleAvailable = ['ready', 'disabled'].includes(entry.state.status)
    if (entry.management.canToggle && toggleAvailable && primaryAction.value !== 'enable' && primaryAction.value !== 'retry') {
      actions.push({ id: 'toggle', label: entry.state.enabled ? '停用' : '启用' })
    }
    if (entry.management.canRecover && primaryAction.value !== 'recover') actions.push({ id: 'recover', label: '备份并恢复状态' })
    return actions
  }
  const toggleAvailable = ['installed-disabled', 'enabled', 'active', 'invoking', 'needs-permission'].includes(entry.package.status)
  if (entry.package.manifestVersion === 3 && entry.package.enabled) actions.push({ id: 'stop', label: '停止运行' })
  if (entry.management.canToggle && toggleAvailable && primaryAction.value !== 'enable') actions.push({ id: 'toggle', label: entry.package.enabled ? '停用' : '启用' })
  if (entry.management.canReplacePackage) actions.push({ id: 'replace', label: '从本地包替换…' })
  if (entry.management.canUninstall) actions.push({ id: 'uninstall', label: '卸载插件…', danger: true })
  return actions
})
const showSplitAction = computed(() => (primaryAction.value === 'open' || primaryAction.value === 'run') && managementActions.value.length > 0)

function closeManagementMenu(restoreFocus = false): void {
  managementMenuOpen.value = false
  if (restoreFocus) void nextTick(() => managementMenuTrigger.value?.focus())
}

function managementMenuItems(): HTMLButtonElement[] {
  return Array.from(managementMenu.value?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])
}

function openManagementMenu(edge: 'first' | 'last' = 'first'): void {
  if (!showSplitAction.value || operationsDisabled.value) return
  managementMenuOpen.value = true
  void nextTick(() => {
    if (!managementMenuOpen.value) return
    const items = managementMenuItems()
    items[edge === 'first' ? 0 : items.length - 1]?.focus()
  })
}

function toggleManagementMenu(): void {
  if (managementMenuOpen.value) closeManagementMenu(true)
  else openManagementMenu()
}

function handleManagementMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeManagementMenu(true); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = managementMenuItems()
  if (!items.length) return
  const current = items.findIndex(item => item === document.activeElement)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : event.key === 'ArrowDown' ? (current + 1) % items.length : (current + items.length - 1) % items.length
  items[index]?.focus()
}

function handleActionFocusOut(event: FocusEvent): void {
  // Chromium can expose BODY as activeElement between focusout and focusin.
  // Keep an internal mouse target mounted until its subsequent click runs.
  if (managementMenuOpen.value
    && (!(event.relatedTarget instanceof Node) || !actionRoot.value?.contains(event.relatedTarget))) closeManagementMenu()
}

function handleOutsidePointer(event: PointerEvent): void {
  if (managementMenuOpen.value && event.target instanceof Node && !actionRoot.value?.contains(event.target)) closeManagementMenu()
}

function handleWindowBlur(): void { closeManagementMenu() }

onMounted(() => {
  document.addEventListener('pointerdown', handleOutsidePointer, true)
  window.addEventListener('blur', handleWindowBlur)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsidePointer, true)
  window.removeEventListener('blur', handleWindowBlur)
})
watch(managementActions, () => closeManagementMenu())
watch(operationsDisabled, disabled => { if (disabled) closeManagementMenu() })

watch(() => props.selection, value => {
  selectedRef.value = value ? { ...value } : null
}, { immediate: true })

watch(selected, plugin => {
  grantedDraft.value = plugin && plugin.kind !== 'builtin' ? plugin.package.granted.filter(cap => cap !== 'network.domains') : []
}, { immediate: true })

function errorText(error: { code: string; message: string }): string { return pluginManagementError(error) }

async function perform(key: string, operation: () => Promise<void>): Promise<void> {
  if (operationsDisabled.value) return
  busy.value = key
  feedback.value = null
  try { await operation() }
  catch { feedback.value = { kind: 'error', text: '插件操作没有完成，请重试。' } }
  finally { busy.value = null; emit('changed') }
}

async function install(): Promise<void> {
  await perform('install', async () => {
    const result = await window.desktop.plugins.installFromUserDialog()
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    feedback.value = { kind: 'status', text: pluginInstallFeedback(result.data) }
  })
}

async function toggle(plugin: PluginSummary): Promise<void> {
  await perform(`toggle:${plugin.id}`, async () => {
    const result = await window.desktop.pluginCatalog.setEnabled({ kind: plugin.manifestVersion === 2 || plugin.manifestVersion === 3 ? 'web' : 'declarative', id: plugin.id }, !plugin.enabled)
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    if (result.data.kind === 'builtin') { feedback.value = { kind: 'error', text: '插件状态响应无效，请重新加载。' }; return }
    feedback.value = result.data.package.enabled
      ? { kind: 'status', text: '插件已启用。' }
      : { kind: 'status', text: plugin.enabled ? '插件已停用；设置和私有数据已保留。' : '权限确认已取消，插件仍保持停用。' }
  })
}

async function stopRuntime(plugin: PluginSummary): Promise<void> {
  await perform(`stop:${plugin.id}`, async () => {
    const result = await window.desktop.plugins.stopRuntime(plugin.id)
    feedback.value = result.ok ? { kind: 'status', text: '已停止插件窗口和后台任务，插件保持启用。' }
      : { kind: 'error', text: errorText(result.error) }
  })
}

async function toggleBuiltin(plugin: BuiltinEntryDTO): Promise<void> {
  if (!plugin.management.canToggle) return
  const enabled = plugin.state.status === 'faulted' ? plugin.state.retryEnabled : !plugin.state.enabled
  await perform('builtin-state', async () => {
    const result = await window.desktop.pluginCatalog.setEnabled(catalogRef(plugin), enabled)
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    feedback.value = { kind: 'status', text: enabled ? '翻译已启用。' : '翻译已停用；翻译设置和 AI 密钥已保留。' }
  })
}

async function recoverBuiltin(): Promise<void> {
  await perform('builtin-recovery', async () => {
    const result = await window.desktop.pluginCatalog.recoverBuiltinTranslation()
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    feedback.value = result.data.recovered
      ? { kind: 'status', text: '原状态文件已备份，翻译状态已恢复为启用。' }
      : { kind: 'status', text: '已取消恢复。' }
  })
}

function toggleDraft(capability: PluginCapability, checked: boolean): void {
  if (capability === 'network.domains') return
  const current = new Set(grantedDraft.value)
  if (checked) current.add(capability); else current.delete(capability)
  grantedDraft.value = [...current]
}

async function savePermissions(): Promise<void> {
  const plugin = selectedPackage.value
  if (!plugin) return
  await perform(`grants:${plugin.id}`, async () => {
    const result = await window.desktop.plugins.setGrants(plugin.id, pluginGrantPayload(grantedDraft.value))
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    grantedDraft.value = result.data.granted.slice()
    feedback.value = { kind: 'status', text: '权限状态已更新。新授予的能力由 WebTools 宿主确认。' }
  })
}

async function uninstall(): Promise<void> {
  const plugin = selectedPackage.value
  if (!plugin) return
  await perform(`uninstall:${plugin.id}`, async () => {
    const result = await window.desktop.plugins.uninstall(plugin.id)
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    feedback.value = result.data.removed
      ? { kind: 'status', text: '插件已卸载；数据是否删除由 WebTools 宿主中的单独选择决定。' }
      : { kind: 'status', text: '卸载已取消。' }
  })
}

function canNavigateTo(ref: PluginRef | null, leaveSection = false): boolean {
  const sameSelection = !ref && !selectedRef.value || ref && selectedRef.value && catalogKey(ref) === catalogKey(selectedRef.value)
  if (!leaveSection && sameSelection) return true
  if (configurationEditor.value) return configurationEditor.value.confirmLeave()
  return !configurationBusy.value && (!configurationDirty.value || window.confirm('放弃尚未保存的插件设置并离开当前页面？'))
}
defineExpose({ canNavigateTo, focusPluginSection })

function select(plugin: CatalogEntryDTO): void {
  if (!canNavigateTo(catalogRef(plugin))) return
  selectedRef.value = catalogRef(plugin)
  emit('selectPlugin', catalogRef(plugin))
  grantedDraft.value = plugin.kind !== 'builtin' ? plugin.package.granted.filter(cap => cap !== 'network.domains') : []
  feedback.value = null
}

function scrollToDetailSection(id: string): void {
  const heading = document.getElementById(id)
  heading?.focus({ preventScroll: true })
  heading?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}

function focusPluginSection(section: 'about' | 'settings'): boolean {
  const id = section === 'about' ? 'plugin-overview-title' : 'plugin-configuration-title'
  const heading = document.getElementById(id)
  if (!heading) return false
  scrollToDetailSection(id)
  return true
}

function runPrimaryAction(): void {
  if (primaryActionDisabled.value) return
  closeManagementMenu()
  const action = primaryAction.value
  if (action === 'enable' && selectedBuiltin.value) { void toggleBuiltin(selectedBuiltin.value); return }
  if (action === 'enable' && selectedPackage.value && selected.value && selected.value.kind !== 'builtin') { void toggle(selectedPackage.value); return }
  if (action === 'retry' && selectedBuiltin.value) { void toggleBuiltin(selectedBuiltin.value); return }
  if (action === 'recover' && selectedBuiltin.value) { void recoverBuiltin(); return }
  if ((action === 'open' || action === 'run') && primaryFeature.value) { emit('openPlugin', primaryFeature.value.ref); return }
  if (action === 'open' && selected.value?.kind === 'declarative' && compatibilityCanOpen.value) { emit('openPlugin', catalogRef(selected.value)); return }
  if (action === 'permissions') scrollToDetailSection('plugin-permission-title')
  if (action === 'health') scrollToDetailSection('plugin-health-title')
}

function runManagementAction(action: ManagementAction): void {
  if (!managementActions.value.some(item => item.id === action) || operationsDisabled.value) return
  closeManagementMenu()
  managementMenuTrigger.value?.focus()
  if (action === 'toggle' && selectedBuiltin.value) { void toggleBuiltin(selectedBuiltin.value); return }
  if (action === 'toggle' && selectedPackage.value) { void toggle(selectedPackage.value); return }
  if (action === 'stop' && selectedPackage.value) { void stopRuntime(selectedPackage.value); return }
  if (action === 'replace') { void install(); return }
  if (action === 'uninstall') { void uninstall(); return }
  if (action === 'recover') void recoverBuiltin()
}
</script>

<template>
  <section class="content-page plugin-manager-page" :class="{ 'manager-grid-page': !selected, 'is-overview': !selected }">
    <header v-if="!selected" class="manager-page-header plugin-manager-heading">
      <div class="manager-page-identity"><span class="manager-page-icon" aria-hidden="true"><Puzzle :size="22" :stroke-width="1.8" /></span><div><h1>插件管理</h1><p class="page-description">管理本机插件，查看功能、权限和使用状态。</p></div></div>
      <button class="primary-button" :disabled="operationsDisabled" @click="install"><PackagePlus :size="15" />{{ busy === 'install' ? '正在安装…' : '安装本地插件' }}</button>
    </header>

    <p v-if="runtimeError" class="plugin-feedback is-error" role="alert"><CircleAlert :size="16" /><span>最近一次插件功能调用未能完成。{{ pluginManagementError(runtimeError) }}</span><button class="text-button" @click="developerExpanded = true">开发者诊断</button></p>
    <p v-if="feedback" class="plugin-feedback" :class="`is-${feedback.kind}`" :role="feedback.kind === 'error' ? 'alert' : 'status'" aria-live="polite"><CircleAlert v-if="feedback.kind === 'error'" :size="16" /><CircleCheck v-else :size="16" />{{ feedback.text }}</p>
    <div v-if="loading" class="plugin-empty-state" role="status" aria-live="polite"><RefreshCw :size="17" class="plugin-spin" />正在读取插件状态…</div>
    <div v-if="error" class="plugin-empty-state plugin-empty-error" role="alert"><CircleAlert :size="17" /><span>{{ error }}</span><button class="secondary-button" :disabled="operationsDisabled" @click="emit('retry')">重新加载</button></div>
    <div v-if="!loading && !error && entries.length === 0" class="plugin-empty-state"><Puzzle :size="23" /><div><strong>尚未安装插件</strong><p>可从本机选择 .wtplugin 文件。安装后可查看权限并启用功能。</p></div></div>

    <section v-if="entries.length > 0 && !selected" class="plugin-overview" aria-labelledby="plugin-overview-heading">
      <div class="manager-grid-toolbar"><h2 id="plugin-overview-heading" class="plugin-overview-title"><LayoutGrid :size="17" />已安装插件</h2><label class="manager-page-search plugin-overview-search"><Search :size="18" aria-hidden="true" /><input v-model="searchQuery" type="search" placeholder="搜索已安装插件…" aria-label="搜索已安装插件" /></label><span class="manager-grid-count">共 {{ overviewEntries.length }} 个插件</span></div>
      <div class="manager-grid plugin-overview-grid">
        <button v-for="plugin in overviewEntries" :key="catalogKey(plugin)" type="button" class="manager-card plugin-overview-card" :disabled="operationsDisabled" @click="select(plugin)">
          <span class="manager-card-icon plugin-overview-icon" aria-hidden="true"><Languages v-if="plugin.icon.kind === 'host'" :size="26" /><img v-else-if="plugin.icon.kind === 'png'" :src="plugin.icon.dataUrl" alt="" /><Puzzle v-else :size="26" /></span>
          <span class="manager-card-copy">
            <strong class="manager-card-title" :title="catalogPresentation(plugin).name">{{ catalogPresentation(plugin).name }}</strong>
            <span class="manager-card-description">{{ catalogPresentation(plugin).description || '未提供插件说明。' }}</span>
            <span class="manager-card-meta"><span>{{ catalogFeatureSummary(plugin) }}</span><span class="plugin-state" :class="'tone-' + catalogPresentation(plugin).status.tone">{{ catalogPresentation(plugin).status.label }}</span></span>
          </span>
          <span class="manager-icon-action plugin-overview-action" aria-hidden="true"><ChevronRight :size="17" /></span>
        </button>
      </div>
      <p v-if="!overviewEntries.length" class="plugin-empty-state">没有匹配的插件，请尝试其他名称或描述。</p>
      <p class="plugin-list-note">启用后，功能可按需调用；不会因此常驻后台。</p>
    </section>

    <section v-if="selected" class="plugin-detail" aria-labelledby="plugin-detail-title">
      <header class="plugin-detail-heading">
        <div class="plugin-row-icon plugin-detail-icon" aria-hidden="true"><Languages v-if="selected.icon.kind === 'host'" :size="23" /><img v-else-if="selected.icon.kind === 'png'" :src="selected.icon.dataUrl" alt="" /><Puzzle v-else :size="23" /></div>
        <div class="plugin-detail-title"><h1 id="plugin-detail-title">{{ catalogPresentation(selected).name }}</h1><p>{{ catalogPresentation(selected).description || '未提供插件说明。' }}</p></div>
        <div ref="actionRoot" class="plugin-header-actions" @focusout="handleActionFocusOut">
          <div v-if="showSplitAction" class="plugin-split-action" :class="{ 'is-disabled': operationsDisabled }">
            <button type="button" class="primary-button plugin-primary-action" :disabled="primaryActionDisabled" @click="runPrimaryAction">{{ primaryActionLabel }}</button>
            <button
              ref="managementMenuTrigger"
              type="button"
              class="plugin-menu-trigger"
              aria-label="更多插件操作"
              aria-haspopup="menu"
              aria-controls="plugin-management-menu"
              :aria-expanded="managementMenuOpen"
              :disabled="operationsDisabled"
              @click="toggleManagementMenu"
              @keydown.down.prevent="openManagementMenu('first')"
              @keydown.up.prevent="openManagementMenu('last')"
            ><ChevronDown :size="14" /></button>
            <div v-if="managementMenuOpen" id="plugin-management-menu" ref="managementMenu" class="plugin-management-popover" role="menu" aria-label="插件管理操作" @keydown="handleManagementMenuKeydown">
              <div v-for="action in managementActions" :key="action.id" class="plugin-menu-entry" :class="{ 'is-destructive': action.danger }" role="none">
                <button type="button" role="menuitem" tabindex="-1" :class="{ 'is-danger': action.danger }" :disabled="operationsDisabled" @click="runManagementAction(action.id)">{{ action.label }}</button>
              </div>
              <p class="plugin-menu-note" role="none"><Check :size="12" />{{ selectedBuiltin ? '停用后保留设置和密钥。' : '停用保留数据；卸载时可单独选择是否删除。' }}</p>
            </div>
          </div>
          <button v-else type="button" class="plugin-primary-action" :class="primaryAction === 'unavailable' ? 'secondary-button' : 'primary-button'" :disabled="primaryActionDisabled" @click="runPrimaryAction">{{ primaryActionLabel }}</button>
        </div>
      </header>

      <section class="plugin-detail-section" aria-labelledby="plugin-features-title">
        <h2 id="plugin-features-title">功能</h2>
        <p class="plugin-section-description">查看可用入口和适用内容。每次调用仍由 WebTools 检查权限与当前状态。</p>
        <article v-for="feature in features" :key="feature.key" class="plugin-feature-row">
          <div class="plugin-feature-heading">
            <div><h3>{{ feature.title }}</h3><p v-if="feature.description">{{ feature.description }}</p><span v-if="features.length > 1 && primaryFeature?.key === feature.key && (primaryAction === 'open' || primaryAction === 'run')" class="plugin-feature-primary-note">顶部“{{ primaryActionLabel }}”使用此功能</span></div>
            <button v-if="features.length > 1 && selectedEnabled && primaryFeature?.key !== feature.key" type="button" class="secondary-button" :disabled="operationsDisabled || !feature.available" @click="emit('openPlugin', feature.ref)">{{ feature.openLabel }}</button>
          </div>
          <dl class="plugin-feature-facts"><div><dt>使用入口</dt><dd>{{ feature.surfaces.join('、') }}</dd></div><div><dt>适用内容</dt><dd>{{ feature.contexts.join('；') }}</dd></div><div><dt>操作方式</dt><dd>{{ feature.action }}</dd></div></dl>
          <p v-if="!feature.available" class="plugin-section-description">当前不可调用，请查看启用状态、权限和运行状态。</p>
        </article>
        <p v-if="features.length === 0" class="plugin-section-description">当前无法读取功能说明。可以重新加载状态或重新导入原始插件包。</p>
      </section>

      <section class="plugin-detail-section" aria-labelledby="plugin-overview-title">
        <h2 id="plugin-overview-title">信息</h2>
        <dl class="plugin-facts">
          <div><dt>版本</dt><dd>{{ catalogPresentation(selected).version }}</dd></div>
          <div><dt>作者</dt><dd>{{ catalogPresentation(selected).author }}<a v-if="selectedPackage?.author?.url" :href="selectedPackage.author.url" target="_blank" rel="noreferrer" aria-label="打开作者网站"><ExternalLink :size="13" /></a></dd></div>
          <div><dt>来源</dt><dd>{{ selectedBuiltin ? '随 WebTools 提供的内置功能' : '本机导入的插件包' }}</dd></div>
          <div><dt>兼容性</dt><dd>{{ selectedBuiltin ? '与当前 WebTools 一同提供' : selectedPackage?.status === 'incompatible' ? '与当前 WebTools 不兼容' : selectedPackage?.api ? `需要 WebTools ${selectedPackage.api.minHostVersion} 或更新版本` : '未提供兼容版本说明' }}</dd></div>
        </dl>
        <p v-if="selectedPackage" class="plugin-trust-note"><ShieldCheck :size="16" /><span>本地插件的发布者未经验证。文件摘要用于完整性识别，不代表身份或安全认证。</span></p>
      </section>

      <section class="plugin-detail-section" aria-labelledby="plugin-permission-title">
        <h2 id="plugin-permission-title" tabindex="-1">权限</h2>
        <template v-if="selectedPackage">
          <p class="plugin-section-description">新授权需经过 WebTools 确认；保存时撤销未选中的权限。</p>
          <fieldset class="plugin-permission-list" :disabled="operationsDisabled"><legend class="visually-hidden">管理 {{ selectedPackage.name }} 的权限</legend>
            <label v-for="permission in permissionRows" :key="permission.id" class="plugin-permission-row">
              <input type="checkbox" :disabled="!permission.grantable" :checked="permission.grantable && grantedDraft.includes(permission.id)" @change="toggleDraft(permission.id, ($event.target as HTMLInputElement).checked)" />
              <span class="plugin-permission-copy"><strong>{{ permission.label }}</strong><small>{{ permission.description }}</small><small v-if="!permission.implemented">当前宿主尚未实现此能力；授权不代表此能力已经可用。</small></span>
              <span class="plugin-permission-status">{{ !permission.grantable ? '不可授予' : permission.granted ? '已授予' : '未授予' }}</span>
            </label>
            <p v-if="permissionRows.length === 0" class="plugin-section-description">此插件未申请额外能力。</p>
          </fieldset>
          <button v-if="permissionRows.length > 0" type="button" class="secondary-button" :disabled="operationsDisabled || !permissionsChanged" @click="savePermissions">{{ busy === `grants:${selectedPackage.id}` ? '正在保存…' : '保存权限' }}</button>
        </template>
        <p v-else class="plugin-section-description">内置翻译由 WebTools 管理，不使用第三方插件的权限授权流程。停用翻译不会停用其他功能使用的共享 AI。</p>
      </section>

      <section class="plugin-detail-section" aria-labelledby="plugin-health-title">
        <div class="plugin-section-heading"><h2 id="plugin-health-title" tabindex="-1">运行状态</h2><span class="plugin-state" :class="'tone-' + catalogPresentation(selected).status.tone">{{ catalogPresentation(selected).status.label }}</span></div>
        <p class="plugin-section-description" :role="healthCode ? 'alert' : undefined">{{ healthDescription }}</p>
        <button type="button" class="text-button" :disabled="operationsDisabled" @click="emit('retry')"><RefreshCw :size="13" />重新读取状态</button>
      </section>

      <section v-if="selectedBuiltin || hasLegacyConfiguration || selected.kind === 'web'" class="plugin-detail-section" aria-labelledby="plugin-configuration-title">
        <h2 id="plugin-configuration-title">配置</h2>
        <template v-if="selectedBuiltin"><p class="plugin-section-description">Translation 2.0 在自己的窗口中管理翻译服务；AI 提供方和凭据继续由平台 AI 统一管理。</p><button class="secondary-button" :disabled="operationsDisabled || primaryAction !== 'open'" @click="emit('openPlugin', catalogRef(selected))">打开翻译窗口</button><button class="secondary-button" :disabled="operationsDisabled" @click="emit('openSettings')">平台 AI 设置</button></template>
        <template v-else-if="hasLegacyConfiguration"><p class="plugin-section-description">已有设置通过兼容页面管理，需要插件已启用并拥有页面权限。当前停用时不可在此编辑设置；不会为显示配置而启动插件。</p><button class="secondary-button" :disabled="operationsDisabled || !compatibilityCanOpen" @click="emit('openPlugin', catalogRef(selected))">打开兼容配置页面</button></template>
        <PluginConfigurationEditor v-else-if="selectedPackage?.manifestVersion === 3" ref="configurationEditor" :identity="{ pluginId: selectedPackage.id, version: selectedPackage.version, hash: selectedPackage.hash }" @busy="configurationBusy = $event" @dirty="configurationDirty = $event" />
        <p v-else class="plugin-section-description">此插件目前没有可用的配置界面。配置和私有数据仍按原有规则保留。</p>
      </section>

      <section v-if="!showSplitAction && managementActions.length" class="plugin-detail-section" aria-labelledby="plugin-management-title">
        <h2 id="plugin-management-title">管理</h2>
        <div class="plugin-management-actions">
          <button v-for="action in managementActions" :key="action.id" type="button" class="secondary-button" :class="{ 'is-danger': action.danger }" :disabled="operationsDisabled" @click="runManagementAction(action.id)">{{ action.label }}</button>
        </div>
        <p class="plugin-section-description">{{ selectedBuiltin ? '停用翻译会保留设置和密钥。' : '停用会保留设置和私有数据；卸载与删除数据分别确认，默认保留数据。' }}</p>
      </section>

      <details class="plugin-advanced">
        <summary>技术信息</summary>
        <dl class="plugin-facts"><div><dt>插件 ID</dt><dd>{{ selected.id }}</dd></div><div v-if="selectedPackage?.api"><dt>宿主 API</dt><dd>API {{ selectedPackage.api.apiMajor }}</dd></div><div v-if="selectedPackage" class="plugin-hash-row"><dt>完整性摘要（SHA-256）</dt><dd><code>{{ selectedPackage.hash }}</code></dd></div><div v-if="selectedPackage && selectedPackage.installedVersions.length > 1" class="plugin-hash-row"><dt>保留版本</dt><dd>{{ selectedPackage.installedVersions.join('、') }}</dd></div><div v-if="healthCode"><dt>状态代码</dt><dd>{{ healthCode }}</dd></div></dl>
      </details>
    </section>

    <details class="plugin-developer-tools" :open="developerExpanded" @toggle="developerExpanded = ($event.target as HTMLDetailsElement).open">
      <summary>开发者工具</summary>
      <PluginDevelopmentPanel v-if="developerExpanded" />
    </details>
  </section>
</template>

<style scoped>
.plugin-manager-page { --plugin-danger: #e4978d; --plugin-warning: #d8b26f; width: min(920px, 100%); max-width: 920px; align-self: center; padding: 30px 32px 36px; }
:global(:root[data-theme='light'] .plugin-manager-page) { --plugin-danger: #a3322a; --plugin-warning: #845619; }
.plugin-manager-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.plugin-manager-heading .primary-button { flex: 0 0 auto; }
.plugin-overview { display: grid; gap: 0; }
.plugin-overview-heading, .plugin-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.plugin-overview-heading { padding: 0 2px 9px; border-bottom: 1px solid var(--line); }
.plugin-overview-heading h2 { margin: 0; font-size: 13px; font-weight: 600; }
.plugin-overview-heading > span, .plugin-list-note { color: var(--muted); font-size: 11px; }
.plugin-overview-title { display: flex; align-items: center; gap: calc(var(--manager-unit) * .5); margin: 0; color: var(--muted); font-size: var(--manager-font-small); font-weight: 500; }
.plugin-overview-card { align-items: flex-start; text-align: left; cursor: pointer; }
.plugin-overview-card:disabled { opacity: .6; cursor: default; }
.plugin-overview-icon { color: var(--manager-action); background: var(--accent-soft); }
.plugin-overview-icon img { width: calc(var(--manager-unit) * 2); height: calc(var(--manager-unit) * 2); object-fit: contain; }
.plugin-overview-search { margin-left: auto; }
.plugin-overview-action { margin-left: auto; flex: 0 0 auto; }
.plugin-list-note { margin: 10px 2px 0; line-height: 1.6; }
.plugin-row-icon { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; overflow: hidden; border-radius: 9px; color: var(--accent); background: var(--accent-soft); }
.plugin-row-icon img { width: 25px; height: 25px; object-fit: contain; }
.plugin-row-copy { display: grid; min-width: 0; flex: 1; gap: 5px; }
.plugin-row-copy > strong, .plugin-row-copy > small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-row-copy > strong { font-size: 12px; font-weight: 600; }
.plugin-row-copy > small, .plugin-row-description { color: var(--muted); font-size: 11px; line-height: 1.55; }
.plugin-row-description { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.plugin-row-meta { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 5px; color: var(--muted); font-size: 10px; margin-top: 3px; }
.plugin-state { display: inline-flex; align-items: center; padding: 3px 6px; border-radius: 5px; color: var(--muted); background: var(--surface-raised); font-size: 10px; white-space: nowrap; }
.tone-good { color: var(--accent); background: var(--accent-soft); }
.tone-warning { color: var(--plugin-warning); background: color-mix(in srgb, var(--plugin-warning) 10%, var(--surface)); }
.tone-danger { color: var(--plugin-danger); background: color-mix(in srgb, var(--plugin-danger) 10%, var(--surface)); }
.tone-quiet { color: var(--muted); }
.plugin-detail { min-width: 0; padding: 0 0 18px; }
.plugin-detail-heading { display: grid; min-width: 0; grid-template-columns: var(--manager-page-icon-size) minmax(0, 1fr) auto; align-items: center; gap: calc(var(--manager-unit) * .875); padding: 0 0 calc(var(--manager-unit) * 1.5); }
.plugin-detail-icon { width: var(--manager-page-icon-size); height: var(--manager-page-icon-size); }
.plugin-detail-icon img { width: calc(var(--manager-unit) * 1.875); height: calc(var(--manager-unit) * 1.875); }
.plugin-detail-title { min-width: 0; }
.plugin-detail-title h1 { overflow-wrap: anywhere; margin: 0; color: var(--text); font-size: var(--manager-font-title); font-weight: 650; letter-spacing: -.02em; }
.plugin-detail-title p { max-width: 62ch; overflow-wrap: anywhere; margin: calc(var(--manager-unit) * .375) 0 0; color: var(--muted); font-size: var(--manager-font-small); line-height: 1.6; }
.plugin-section-description { overflow-wrap: anywhere; margin: 6px 0 12px; color: var(--muted); font-size: 11px; line-height: 1.65; }
.plugin-detail-section { padding: 20px 0; border-top: 1px solid var(--line); }
.plugin-detail-section > :last-child { margin-bottom: 0; }
.plugin-detail-section > h2, .plugin-section-heading > h2 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.plugin-section-heading > h2 { margin-bottom: 0; }
.plugin-detail-section h2:focus-visible { border-radius: 3px; outline: 2px solid var(--accent); outline-offset: 4px; }
.plugin-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px 18px; padding: 0; margin: 12px 0 0; }
.plugin-facts > div { min-width: 0; }
.plugin-facts dt { margin-bottom: 5px; color: var(--muted); font-size: 10px; }
.plugin-facts dd { display: flex; min-width: 0; align-items: center; gap: 5px; overflow-wrap: anywhere; margin: 0; color: var(--text); font-size: 11px; line-height: 1.6; }
.plugin-facts a { display: inline-flex; color: var(--accent); }
.plugin-hash-row { grid-column: 1 / -1; }
.plugin-hash-row code { overflow-wrap: anywhere; font-size: 10px; }
.plugin-trust-note { display: flex; align-items: flex-start; gap: 8px; margin: 15px 0 0; color: var(--muted); font-size: 10px; line-height: 1.6; }
.plugin-trust-note svg { flex: 0 0 auto; margin-top: 2px; }
.plugin-feature-row { padding: 13px 0; }
.plugin-feature-row + .plugin-feature-row { border-top: 1px solid var(--line); }
.plugin-feature-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.plugin-feature-heading > div { min-width: 0; }
.plugin-feature-heading h3 { margin: 0; font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
.plugin-feature-heading p { max-width: 68ch; margin: 5px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.plugin-feature-heading button { flex: 0 0 auto; }
.plugin-feature-primary-note { display: block; margin-top: 6px; color: var(--muted); font-size: 10px; }
.plugin-feature-facts { display: grid; gap: 6px; margin: 12px 0 0; font-size: 11px; line-height: 1.6; }
.plugin-feature-facts > div { display: grid; grid-template-columns: 60px minmax(0, 1fr); gap: 10px; }
.plugin-feature-facts dt { color: var(--muted); }
.plugin-feature-facts dd { margin: 0; overflow-wrap: anywhere; }
.plugin-permission-list { display: grid; gap: 2px; padding: 0; margin: 0 0 12px; border: 0; }
.plugin-permission-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: start; gap: 8px; padding: 10px 0; color: var(--text); }
.plugin-permission-row input { accent-color: var(--accent); margin-top: 2px; }
.plugin-permission-copy { display: grid; gap: 4px; }
.plugin-permission-copy strong { font-size: 11px; font-weight: 500; }
.plugin-permission-copy small, .plugin-permission-status { color: var(--muted); font-size: 10px; line-height: 1.6; }
.plugin-permission-list:disabled { opacity: .65; }
.plugin-header-actions { position: relative; justify-self: end; }
.plugin-primary-action { height: 36px; min-height: 36px; min-width: 84px; padding-inline: 14px; font-size: 12px; white-space: nowrap; }
.plugin-manager-page .plugin-header-actions .primary-button { color: var(--accent-ink); border-color: var(--accent); background: var(--accent); }
.plugin-manager-page .plugin-header-actions .primary-button:hover:not(:disabled), .plugin-menu-trigger:hover:not(:disabled), .plugin-menu-trigger[aria-expanded='true'] { color: var(--accent-ink); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 90%, black); }
.plugin-manager-page .plugin-header-actions .primary-button:active:not(:disabled), .plugin-menu-trigger:active:not(:disabled) { background: color-mix(in srgb, var(--accent) 80%, black); }
.plugin-primary-action:disabled { opacity: .5; cursor: not-allowed; }
.plugin-manager-page .secondary-button:disabled { opacity: .5; color: var(--text); border-color: var(--line); background: var(--surface-raised); cursor: not-allowed; }
.plugin-split-action { position: relative; display: inline-flex; height: 36px; align-items: stretch; gap: 0; border: 1px solid var(--accent); border-radius: 8px; background: var(--accent); }
.plugin-split-action > .plugin-primary-action { height: 34px; min-height: 34px; border: 0; border-radius: 7px 0 0 7px; }
.plugin-menu-trigger { display: grid; width: 34px; height: 34px; flex: 0 0 34px; place-items: center; padding: 0; border: 0; border-left: 1px solid color-mix(in srgb, var(--accent-ink) 20%, var(--accent)); border-radius: 0 7px 7px 0; color: var(--accent-ink); background: var(--accent); cursor: pointer; }
.plugin-menu-trigger:hover:not(:disabled), .plugin-menu-trigger[aria-expanded='true'] { border-left-color: color-mix(in srgb, var(--accent-ink) 20%, var(--accent)); }
.plugin-split-action.is-disabled { opacity: .5; }
.plugin-split-action > button:disabled { opacity: 1; cursor: not-allowed; }
.plugin-header-actions > button:focus-visible, .plugin-split-action > button:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--accent); outline-offset: 3px; }
.plugin-management-popover { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; width: 220px; max-width: calc(100vw - 36px); padding: 5px; border: 1px solid var(--line); border-radius: 8px; color: var(--text); background: var(--surface); box-shadow: 0 8px 24px color-mix(in srgb, #000 18%, transparent); }
.plugin-menu-entry.is-destructive { padding-top: 4px; margin-top: 4px; border-top: 1px solid var(--line); }
.plugin-menu-entry > button { display: block; width: 100%; min-height: 32px; padding: 7px 10px; border: 0; border-radius: 5px; color: var(--text); background: transparent; text-align: left; font: inherit; font-size: 12px; cursor: pointer; }
.plugin-menu-entry > button:hover:not(:disabled), .plugin-menu-entry > button:focus-visible { background: var(--hover); }
.plugin-menu-entry > button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.plugin-menu-entry > button:active:not(:disabled) { background: var(--selected); }
.plugin-menu-entry > button:disabled { opacity: .5; cursor: not-allowed; }
.plugin-menu-entry > button.is-danger, .plugin-management-actions > .is-danger { color: var(--plugin-danger); }
.plugin-menu-entry > button.is-danger:hover:not(:disabled), .plugin-management-actions > .is-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--plugin-danger) 10%, var(--surface)); }
.plugin-management-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.plugin-management-actions > .is-danger { padding-left: 12px; margin-left: 4px; border-color: color-mix(in srgb, var(--plugin-danger) 30%, var(--line)); }
.plugin-management-actions > button:disabled, .plugin-feature-heading > button:disabled { opacity: .5; cursor: not-allowed; }
.plugin-menu-note { display: flex; align-items: flex-start; gap: 6px; padding: 9px 6px 4px; margin: 4px 4px 1px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; line-height: 1.6; white-space: normal; }
.plugin-menu-note svg { flex: 0 0 auto; margin-top: 1px; color: var(--accent); }
.plugin-feedback, .plugin-empty-state { display: flex; align-items: center; gap: 9px; padding: 12px; margin: 0 0 15px; border-radius: 8px; color: var(--muted); background: var(--surface); font-size: 11px; line-height: 1.6; }
.plugin-feedback { color: var(--accent); }
.plugin-feedback > span { min-width: 0; flex: 1; }
.plugin-feedback.is-error, .plugin-empty-error { color: var(--plugin-danger); }
.plugin-empty-state { min-height: 90px; }
.plugin-empty-state strong { color: var(--text); font-size: 12px; }
.plugin-empty-state p { margin: 5px 0 0; }
.plugin-empty-state .secondary-button { margin-left: auto; flex: 0 0 auto; }
.plugin-advanced, .plugin-developer-tools { padding: 15px 0; border-top: 1px solid var(--line); }
.plugin-advanced summary, .plugin-developer-tools summary { color: var(--muted); font-size: 11px; cursor: pointer; border-radius: 4px; }
.plugin-advanced summary:focus-visible, .plugin-developer-tools summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.plugin-developer-tools { margin-top: 20px; }
.plugin-developer-tools :deep(.plugin-development-panel) { margin: 14px 0 0; }
.plugin-spin { animation: plugin-spin 1.2s linear infinite; }
@keyframes plugin-spin { to { transform: rotate(360deg); } }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; clip-path: inset(50%); }
@media (max-width: 900px) { .plugin-manager-page { padding: 28px 24px 32px; } }
@media (max-width: 680px) { .plugin-manager-page { padding: 24px 18px 28px; } .plugin-manager-heading { align-items: flex-start; flex-direction: column; } .plugin-facts { grid-template-columns: 1fr; } .plugin-hash-row { grid-column: auto; } .plugin-feature-heading { flex-wrap: wrap; } .plugin-detail-heading { align-items: start; row-gap: 16px; } .plugin-header-actions { grid-column: 2 / -1; justify-self: start; } .plugin-feedback { flex-wrap: wrap; } }
.plugin-manager-page.is-overview { width: calc(100% - 28px); max-width: none; align-self: stretch; padding: var(--manager-page-padding); }
@media (prefers-reduced-motion: reduce) { .plugin-spin { animation: none; } }
</style>
