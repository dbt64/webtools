<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ChevronDown, Copy, Ellipsis, Globe, Languages, Minus, Puzzle, Settings2, SlidersHorizontal, Square, X,
} from '@lucide/vue'
import logoDark from '@/assets/brand/logo-dark.svg'
import logoLight from '@/assets/brand/logo-light.svg'
import FavoritesView from './features/favorites/FavoritesView.vue'
import WebRuntimeView from './features/plugins/WebRuntimeView.vue'
import type { NativeManagerIntent } from './shared/ipc'
import type { PluginPageDTO } from './shared/plugin-contracts.ts'
import type { CatalogEntryDTO, PluginRef } from './shared/plugin-catalog-contracts.ts'
import { catalogCanOpen, catalogInstalledNavigationItems, catalogKey, catalogPresentation, catalogShouldReturnToCenter, isCurrentCatalogRequest } from './features/plugins/catalog-view-model.ts'


type Section = 'favorites' | 'settings' | 'plugins' | 'plugin-page' | 'web-runtime'

function createSettingsLoadState(message: string, role: 'status' | 'alert') {
  return defineComponent({
    name: role === 'status' ? 'SettingsLoadingState' : 'SettingsErrorState',
    setup: () => () => h('section', { class: 'content-page settings-load-state' }, [
      h('div', { class: 'page-heading' }, [h('div', [
        h('p', { class: 'eyebrow' }, '偏好与连接'),
        h('h1', '设置'),
        h('p', { class: 'page-description', role, 'aria-live': role === 'status' ? 'polite' : 'assertive' }, message),
      ])]),
    ]),
  })
}

const SettingsLoading = createSettingsLoadState('正在加载设置…', 'status')
const SettingsLoadError = createSettingsLoadState('设置暂时无法加载，请返回其他页面后重试。', 'alert')
const SettingsView = defineAsyncComponent({
  loader: () => import('./features/settings/SettingsView.vue'),
  loadingComponent: SettingsLoading,
  errorComponent: SettingsLoadError,
  delay: 0,
})

function createPluginLoadState(message: string) {
  return defineComponent({
    name: 'PluginLoadingState',
    setup: () => () => h('section', { class: 'content-page settings-load-state', role: 'status', 'aria-live': 'polite' }, [
      h('div', { class: 'page-heading' }, [h('div', [h('p', { class: 'eyebrow' }, '应用扩展'), h('h1', '插件'), h('p', { class: 'page-description' }, message)])]),
    ]),
  })
}
const PluginLoading = createPluginLoadState('正在加载插件管理…')
const DeclarativeLoading = createPluginLoadState('正在打开插件页面…')
const PluginManagerView = defineAsyncComponent({ loader: () => import('./features/plugins/PluginManagerView.vue'), loadingComponent: PluginLoading, delay: 0 })
const DeclarativePluginView = defineAsyncComponent({ loader: () => import('./features/plugins/DeclarativePluginView.vue'), loadingComponent: DeclarativeLoading, delay: 0 })

const activeSection = ref<Section>('favorites')
const webRuntimeGeneration = ref(0)
const webRuntimeFailure = ref<{ pluginId?: string; code: string } | null>(null)
const pluginCenterSelection = ref<PluginRef | null>(null)
const pluginManagerView = ref<{ canNavigateTo(ref: PluginRef | null, leaveSection?: boolean): boolean; focusPluginSection(section: 'about' | 'settings'): boolean } | null>(null)
function canNavigateConfiguration(section: Section, selection: PluginRef | null = pluginCenterSelection.value): boolean {
  return activeSection.value !== 'plugins' || pluginManagerView.value?.canNavigateTo(selection, section !== 'plugins') !== false
}
function navigateSection(section: Section): void {
  if (canNavigateConfiguration(section)) activeSection.value = section
}
const catalogEntries = ref<CatalogEntryDTO[]>([])
const pluginsLoading = ref(false)
const pluginsError = ref('')
const activePluginRef = ref<PluginRef | null>(null)
const activePluginPage = ref<PluginPageDTO | null>(null)
const pluginPageLoading = ref(false)
const pluginPageError = ref('')
const activeEntry = computed(() => activePluginRef.value ? catalogEntries.value.find(entry => catalogKey(entry) === catalogKey(activePluginRef.value!)) : undefined)
const activePluginName = computed(() => activeEntry.value ? catalogPresentation(activeEntry.value).name : '插件')
const selectedPluginEntry = computed(() => pluginCenterSelection.value ? catalogEntries.value.find(entry => catalogKey(entry) === catalogKey(pluginCenterSelection.value!)) : undefined)
const pluginNavItems = computed(() => catalogInstalledNavigationItems(catalogEntries.value))
const pluginsExpanded = ref(true)
const websiteCount = ref<number | null>(null)
const managerContent = ref<HTMLElement | null>(null)
watch([activeSection, () => pluginCenterSelection.value ? catalogKey(pluginCenterSelection.value) : ''], () => {
  if (!managerContent.value) return
  managerContent.value.scrollTop = 0
  managerContent.value.scrollLeft = 0
}, { flush: 'post' })
let catalogRevision = -1
let disposed = false
let pluginRefreshGeneration = 0
let pluginPageGeneration = 0
let removeNativeManagerIntentListener: (() => void) | undefined
let removeWebRuntimeListener: (() => void) | undefined
let sectionBeforeWebRuntime: Section = 'plugins'
let latestWebRuntimeGeneration = -1
const currentNativeRequestId = ref<string | null>(null)
const managerMenuOpen = ref(false)
const managerMaximized = ref(false)
const managerTitlebar = ref<HTMLElement | null>(null)
const superPanelSettingsFocusRequest = ref<string | undefined>()
const aiSettingsFocusRequest = ref<string | undefined>()
function showSettings(): void {
  if (!canNavigateConfiguration('settings')) return
  superPanelSettingsFocusRequest.value = undefined; aiSettingsFocusRequest.value = undefined; activeSection.value = 'settings'
}
function showAISettings(): void {
  if (!canNavigateConfiguration('settings')) return
  superPanelSettingsFocusRequest.value = undefined; aiSettingsFocusRequest.value = crypto.randomUUID(); activeSection.value = 'settings'
}

const navItems: { id: Section; label: string; icon: typeof Globe }[] = [
  { id: 'favorites', label: '网址', icon: Globe },
]

const sectionLabel = computed(() => activeSection.value === 'plugins'
    ? (selectedPluginEntry.value ? catalogPresentation(selectedPluginEntry.value).name : '插件管理')
    : activeSection.value === 'plugin-page' || activeSection.value === 'web-runtime'
      ? activePluginName.value
  : navItems.find((item) => item.id === activeSection.value)?.label ?? '设置')

onMounted(() => {
  document.addEventListener('pointerdown', closeManagerMenuOnOutside)
  removeNativeManagerIntentListener = window.desktop.onNativeManagerIntent((intent) => handleNativeManagerIntent(intent))
  removeWebRuntimeListener = window.desktop.webRuntime.onState(status => {
    if (status.generation < latestWebRuntimeGeneration) return
    latestWebRuntimeGeneration = status.generation
    webRuntimeGeneration.value = status.generation
    if (status.errorCode) webRuntimeFailure.value = { pluginId: status.pluginId, code: status.errorCode }
    else if (status.state === 'READY' && webRuntimeFailure.value?.pluginId === status.pluginId) webRuntimeFailure.value = null
    if (status.state === 'CREATING' || status.state === 'LOADING' || status.state === 'READY') {
      if (activeSection.value !== 'web-runtime') sectionBeforeWebRuntime = activeSection.value === 'plugin-page' && activePluginRef.value?.kind === 'web'
        ? 'plugins' : activeSection.value
      activeSection.value = 'web-runtime'
    } else if ((status.state === 'CLOSED' || status.state === 'ABSENT') && activeSection.value === 'web-runtime') {
      activeSection.value = sectionBeforeWebRuntime
    }
  })
  window.desktop.managerReady()
  void refreshPlugins()
})

onBeforeUnmount(() => {
  disposed = true
  pluginRefreshGeneration += 1
  pluginPageGeneration += 1
  removeNativeManagerIntentListener?.()
  removeWebRuntimeListener?.()
  document.removeEventListener('pointerdown', closeManagerMenuOnOutside)
})

function closeManagerMenuOnOutside(event: PointerEvent): void {
  if (event.target instanceof Node && managerTitlebar.value?.contains(event.target)) return
  managerMenuOpen.value = false
}

async function performManagerWindowAction(action: 'minimize' | 'toggle-maximize' | 'close'): Promise<void> {
  managerMenuOpen.value = false
  const result = await window.desktop.managerWindow.perform(action).catch(() => null)
  if (result?.ok) managerMaximized.value = result.data.maximized
}

function selectManagerMenuSection(section: 'favorites' | 'plugins' | 'settings'): void {
  managerMenuOpen.value = false
  if (section === 'plugins') showPluginCenter()
  else if (section === 'settings') showSettings()
  else navigateSection(section)
}

function handleNativeManagerIntent(intent: NativeManagerIntent): void {
  const target: Section = intent.kind === 'open-plugin' || intent.kind === 'open-feature' ? 'plugin-page'
    : intent.kind === 'select-plugin' ? 'plugins' : intent.section === 'entries' ? 'favorites' : intent.section
  if (!canNavigateConfiguration(target, intent.kind === 'select-plugin' ? intent.ref : pluginCenterSelection.value)) {
    window.desktop.acknowledgeNativeManagerIntent(intent.requestId, 'rejected')
    return
  }
  currentNativeRequestId.value = intent.requestId
  if (intent.kind === 'select-plugin') {
    activeSection.value = 'plugins'
    void (async () => {
      const refreshed = await refreshPlugins()
      if (disposed || currentNativeRequestId.value !== intent.requestId || activeSection.value !== 'plugins') return
      const exists = refreshed && catalogEntries.value.some(entry => catalogKey(entry) === catalogKey(intent.ref))
      if (!exists) { acknowledgeNativeIntent(intent.requestId, false); return }
      pluginPageGeneration += 1
      activePluginRef.value = null
      activePluginPage.value = null
      pluginPageLoading.value = false
      pluginPageError.value = ''
      pluginCenterSelection.value = { ...intent.ref }
      activeSection.value = 'plugins'
      if (intent.section) await import('./features/plugins/PluginManagerView.vue')
      await nextTick()
      if (disposed || currentNativeRequestId.value !== intent.requestId || activeSection.value !== 'plugins') return
      const focused = intent.section ? pluginManagerView.value?.focusPluginSection(intent.section) ?? false : true
      acknowledgeNativeIntent(intent.requestId, focused)
    })()
    return
  }
  if (intent.kind === 'open-plugin') {
    activeSection.value = 'plugins'
    void (async () => {
      const refreshed = await refreshPlugins()
      if (disposed || currentNativeRequestId.value !== intent.requestId || activeSection.value !== 'plugins') return
      const opened = refreshed && await openPluginPage(intent.ref)
      await nextTick()
      acknowledgeNativeIntent(intent.requestId, opened)
    })()
    return
  }
  if (intent.kind === 'open-feature') {
    activeSection.value = 'plugins'
    void (async () => {
      const refreshed = await refreshPlugins()
      if (disposed || currentNativeRequestId.value !== intent.requestId || activeSection.value !== 'plugins') return
      const supported = intent.ref.pluginId !== 'webtools.translation' && intent.ref.featureId === 'legacy-manager-page'
      const opened = refreshed && supported && await openPluginPage({ kind: 'declarative', id: intent.ref.pluginId })
      await nextTick()
      acknowledgeNativeIntent(intent.requestId, opened)
    })()
    return
  }
  const targetSection: Section = intent.section === 'entries' ? 'favorites' : intent.section
  aiSettingsFocusRequest.value = undefined
  superPanelSettingsFocusRequest.value = intent.section === 'settings' && intent.settingsSection === 'super-panel' ? intent.requestId : undefined
  activeSection.value = targetSection
  void nextTick().then(() => {
    if (currentNativeRequestId.value !== intent.requestId) return
    acknowledgeNativeIntent(intent.requestId, true)
  })
}

function acknowledgeNativeIntent(requestId: string, accepted: boolean): void {
  if (disposed || currentNativeRequestId.value !== requestId) return
  window.desktop.acknowledgeNativeManagerIntent(requestId, accepted ? 'accepted' : 'rejected')
  currentNativeRequestId.value = null
}

function showPluginCenter(): void {
  if (!canNavigateConfiguration('plugins', null)) return
  pluginCenterSelection.value = null
  activePluginRef.value = null
  activePluginPage.value = null
  pluginPageLoading.value = false
  pluginPageError.value = ''
  pluginPageGeneration += 1
  activeSection.value = 'plugins'
}

function selectPluginDetail(ref: PluginRef): void {
  if (!catalogEntries.value.some(entry => catalogKey(entry) === catalogKey(ref))) return
  if (!canNavigateConfiguration('plugins', ref)) return
  pluginPageGeneration += 1
  activePluginRef.value = null
  activePluginPage.value = null
  pluginPageLoading.value = false
  pluginPageError.value = ''
  pluginCenterSelection.value = { ...ref }
  activeSection.value = 'plugins'
}

async function refreshPlugins(): Promise<boolean> {
  const generation = ++pluginRefreshGeneration
  pluginsLoading.value = true
  pluginsError.value = ''
  try {
    const result = await window.desktop.pluginCatalog.list()
    if (disposed || generation !== pluginRefreshGeneration) return false
    if (!result.ok) { pluginsError.value = result.error.message; return false }
    if (result.data.revision < catalogRevision) return false
    catalogRevision = result.data.revision
    catalogEntries.value = result.data.entries
    if (pluginCenterSelection.value && !result.data.entries.some(entry => catalogKey(entry) === catalogKey(pluginCenterSelection.value!))) {
      pluginCenterSelection.value = null
    }
    if (result.data.declarativeAvailability.status === 'unavailable') pluginsError.value = '第三方插件暂时无法读取；内置翻译仍可使用。请重试。'
    if (activeSection.value === 'plugin-page' && catalogShouldReturnToCenter(activePluginRef.value, result.data.entries)) returnToPluginCenter()
    return true
  } catch { if (!disposed && generation === pluginRefreshGeneration) pluginsError.value = '无法读取插件目录，请重试。'; return false }
  finally { if (!disposed && generation === pluginRefreshGeneration) pluginsLoading.value = false }
}

async function openPluginPage(ref: PluginRef): Promise<boolean> {
  if (!canNavigateConfiguration('plugin-page')) return false
  const generation = ++pluginPageGeneration
  const entry = catalogEntries.value.find(item => catalogKey(item) === catalogKey(ref))
  if (!entry || !catalogCanOpen(entry)) { returnToPluginCenter(); return false }
  pluginCenterSelection.value = { ...ref }
  activePluginRef.value = { ...ref }
  activePluginPage.value = null
  pluginPageError.value = ''
  pluginPageLoading.value = true
  activeSection.value = 'plugin-page'
  const current = () => !disposed && isCurrentCatalogRequest({ section: activeSection.value, ref: activePluginRef.value, generation: pluginPageGeneration }, { section: 'plugin-page', ref, generation })
  try {
    const result = await window.desktop.pluginCatalog.open({ ...ref })
    if (result.ok && result.data.kind === 'web') {
      if (disposed || generation !== pluginPageGeneration || ref.kind !== 'web' || result.data.id !== ref.id) return false
      pluginPageLoading.value = false
      returnToPluginCenter()
      return true // Feature presentation is owned by an independent Main-process window.
    }
    if (!current()) return false
    if (!result.ok) { pluginPageError.value = result.error.message; pluginPageLoading.value = false; void refreshPlugins(); return false }
    const latest = catalogEntries.value.find(item => catalogKey(item) === catalogKey(ref))
    if (!latest || !catalogCanOpen(latest)) { returnToPluginCenter(); void refreshPlugins(); return false }
    if (result.data.kind === 'builtin') {
      if (ref.kind !== 'builtin' || latest.kind !== 'builtin' || result.data.id !== ref.id || result.data.key !== latest.entry.key) { returnToPluginCenter(); return false }
      if (result.data.presentation === 'window') {
        pluginPageLoading.value = false
        returnToPluginCenter()
        return true
      }
      returnToPluginCenter()
      return false // Built-in Translation is presented only in its independent window.
    }
    if (result.data.kind !== 'declarative') return false
    const page = result.data.page
    if (ref.kind !== 'declarative' || latest.kind !== 'declarative' || page.pluginId !== ref.id || page.version !== latest.package.version || page.hash !== latest.package.hash) {
      returnToPluginCenter(); void refreshPlugins(); return false
    }
    activePluginPage.value = page
    pluginPageLoading.value = false
    return true
  } catch {
    if (!current()) return false
    pluginPageError.value = '插件页面暂时无法加载，请重试。'
    pluginPageLoading.value = false
    void refreshPlugins()
    return false
  }
}

function returnToPluginCenter(): void {
  pluginPageGeneration += 1
  activePluginRef.value = null
  activePluginPage.value = null
  pluginPageLoading.value = false
  pluginPageError.value = ''
  activeSection.value = 'plugins'
}

</script>

<template>
  <div class="app-frame">
    <header ref="managerTitlebar" class="manager-window-titlebar">
      <div class="manager-titlebar-identity"><span class="manager-titlebar-mark"><img class="brand-logo-dark" :src="logoDark" alt="" /><img class="brand-logo-light" :src="logoLight" alt="" /></span><strong>WebTools</strong></div>
      <div class="manager-titlebar-controls">
        <button class="manager-window-control manager-menu-trigger" type="button" aria-label="Manager 菜单" :aria-expanded="managerMenuOpen" @click="managerMenuOpen = !managerMenuOpen"><Ellipsis :size="19" /></button>
        <button class="manager-window-control" type="button" aria-label="最小化 Manager" title="最小化" @click="performManagerWindowAction('minimize')"><Minus :size="16" /></button>
        <button class="manager-window-control" type="button" :aria-label="managerMaximized ? '还原 Manager' : '最大化 Manager'" :title="managerMaximized ? '还原' : '最大化'" @click="performManagerWindowAction('toggle-maximize')"><Copy v-if="managerMaximized" :size="15" /><Square v-else :size="15" /></button>
        <button class="manager-window-control manager-window-close" type="button" aria-label="关闭 Manager" title="关闭" @click="performManagerWindowAction('close')"><X :size="17" /></button>
      </div>
      <nav v-if="managerMenuOpen" class="manager-window-menu" aria-label="Manager 菜单">
        <button type="button" @click="selectManagerMenuSection('favorites')"><Globe :size="15" />网址</button>
        <button type="button" @click="selectManagerMenuSection('plugins')"><Puzzle :size="15" />插件</button>
        <button type="button" @click="selectManagerMenuSection('settings')"><Settings2 :size="15" />设置</button>
        <div class="manager-window-menu-divider"></div>
        <button type="button" @click="performManagerWindowAction('close')"><X :size="15" />关闭 Manager</button>
      </nav>
    </header>
    <aside class="sidebar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true">
          <img class="brand-logo brand-logo-dark" :src="logoDark" alt="" />
          <img class="brand-logo brand-logo-light" :src="logoLight" alt="" />
        </div>
        <div>
          <div class="brand-name">WebTools</div>
          <div class="brand-caption">个人效率空间</div>
        </div>
      </div>

      <div class="sidebar-label">工作区</div>
      <nav class="primary-nav" aria-label="主导航">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="nav-item"
          :class="{ 'is-active': activeSection === item.id }"
          @click="navigateSection(item.id)"
        >
          <component :is="item.icon" :size="20" :stroke-width="1.8" />
          <span>{{ item.label }}</span>
          <small v-if="item.id === 'favorites' && websiteCount !== null" class="nav-count">{{ websiteCount }}</small>
        </button>
        <button type="button" class="plugin-group-heading" :aria-expanded="pluginsExpanded" aria-controls="installed-plugin-navigation" @click="pluginsExpanded = !pluginsExpanded">
          <span>插件</span>
          <ChevronDown :size="15" :class="{ 'is-expanded': pluginsExpanded }" />
        </button>
        <div v-show="pluginsExpanded" id="installed-plugin-navigation" class="plugin-subnav" role="group" aria-label="插件">
          <button
            v-for="item in pluginNavItems"
            :key="item.key"
            type="button"
            class="nav-item nav-subitem"
            :class="{ 'is-active': activeSection === 'plugins' && pluginCenterSelection && catalogKey(pluginCenterSelection) === item.key }"
            :aria-current="activeSection === 'plugins' && pluginCenterSelection && catalogKey(pluginCenterSelection) === item.key ? 'page' : undefined"
            :title="item.label"
            @click="selectPluginDetail(item.ref)"
          >
            <Languages v-if="item.icon.kind === 'host'" :size="18" :stroke-width="1.8" />
            <img v-else-if="item.icon.kind === 'png'" :src="item.icon.dataUrl" alt="" />
            <Puzzle v-else :size="18" :stroke-width="1.8" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </nav>

      <div class="sidebar-bottom">
        <button class="nav-item" :class="{ 'is-active': activeSection === 'settings' || (activeSection === 'plugins' && !pluginCenterSelection) }" @click="showSettings">
          <Settings2 :size="20" :stroke-width="1.8" />
          <span>设置</span>
        </button>
        <div class="profile-row">
          <div class="profile-avatar">Z</div>
          <div class="profile-copy">
            <span>本机空间</span>
            <small>只保存在这台电脑</small>
          </div>
          <SlidersHorizontal :size="15" class="profile-tune" />
        </div>
      </div>
    </aside>

    <main class="main-panel">
      <header class="topbar">
        <div class="breadcrumb"><span>{{ activeSection === 'plugins' ? (selectedPluginEntry ? '插件' : '设置') : '工作区' }}</span><span class="breadcrumb-slash">/</span><strong>{{ activeSection === 'plugins' && selectedPluginEntry ? '插件详情' : sectionLabel }}</strong></div>
      </header>

      <WebRuntimeView v-if="activeSection === 'web-runtime'" :generation="webRuntimeGeneration" />
      <div v-else ref="managerContent" class="manager-content">
        <aside v-if="webRuntimeFailure && activeSection !== 'plugins'" class="translation-handoff-banner" role="alert">
          <span>插件启动失败。错误代码：{{ webRuntimeFailure.code }}</span>
          <button class="secondary-button" @click="activeSection = 'plugins'">查看插件</button>
          <button class="text-button" @click="webRuntimeFailure = null">关闭提示</button>
        </aside>

        <FavoritesView v-if="activeSection === 'favorites'" @count-change="websiteCount = $event" />
        <SettingsView v-else-if="activeSection === 'settings'" :super-panel-focus-request-id="superPanelSettingsFocusRequest" :ai-focus-request-id="aiSettingsFocusRequest" @open-plugin-management="showPluginCenter" />
        <PluginManagerView v-else-if="activeSection === 'plugins'" ref="pluginManagerView" :entries="catalogEntries" :selection="pluginCenterSelection" :loading="pluginsLoading" :error="pluginsError" :runtime-error="webRuntimeFailure" @select-plugin="pluginCenterSelection = $event" @retry="refreshPlugins" @changed="refreshPlugins" @open-plugin="openPluginPage" @open-settings="showAISettings" />
        <DeclarativePluginView v-else-if="activeSection === 'plugin-page' && activePluginPage" :page="activePluginPage" :plugin-name="activePluginName" @leave="returnToPluginCenter" />
        <section v-else-if="activeSection === 'plugin-page'" class="content-page settings-load-state" role="status" aria-live="polite">
          <div class="page-heading"><div><p class="eyebrow">插件页面</p><h1>{{ activePluginName }}</h1><p class="page-description" :role="pluginPageError ? 'alert' : 'status'">{{ pluginPageError || (pluginPageLoading ? '正在载入声明式页面…' : '页面当前不可用。') }}</p></div></div>
          <button v-if="pluginPageError && activePluginRef" class="secondary-button" @click="openPluginPage(activePluginRef!)">重试</button><button class="secondary-button" @click="returnToPluginCenter">返回插件管理</button>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.translation-handoff-banner { display: flex; align-items: center; gap: 10px; padding: 9px 12px; margin: 0 30px 12px; border-radius: 8px; color: var(--text); background: var(--surface); font-size: 10px; }
.translation-handoff-banner > span { min-width: 0; flex: 1; color: var(--muted); }
.translation-handoff-banner .secondary-button { min-height: 30px; padding: 0 9px; }
.translation-handoff-banner .text-button { flex: 0 0 auto; }
.manager-window-titlebar { position: absolute; z-index: 20; inset: 0 0 auto; display: flex; height: 42px; align-items: center; justify-content: space-between; padding-left: 14px; border-bottom: 1px solid var(--manager-border); color: var(--text); background: var(--manager-chrome); -webkit-app-region: drag; }
.manager-titlebar-identity { display: flex; min-width: 0; align-items: center; gap: 8px; overflow: hidden; }
.manager-titlebar-mark { display: grid; width: 25px; height: 25px; flex: 0 0 25px; place-items: center; border-radius: 7px; background: #000; }
.manager-titlebar-mark img { width: 19px; height: 19px; object-fit: contain; }
.manager-titlebar-identity strong { overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.manager-titlebar-controls { display: flex; height: 100%; align-items: center; -webkit-app-region: no-drag; }
.manager-window-control { display: grid; width: 42px; height: 100%; place-items: center; padding: 0; border: 0; color: var(--muted); background: transparent; cursor: pointer; -webkit-app-region: no-drag; }
.manager-window-control:hover { color: var(--text); background: var(--hover); }
.manager-window-close:hover { color: #fff; background: #c42b1c; }
.manager-window-menu { position: absolute; z-index: 30; top: calc(100% + 5px); right: 138px; display: grid; width: 184px; gap: 2px; padding: 5px; border: 1px solid var(--manager-border); border-radius: 9px; background: var(--manager-page); box-shadow: 0 8px 28px #0003; -webkit-app-region: no-drag; }
.manager-window-menu button { display: flex; min-height: 34px; align-items: center; gap: 9px; padding: 0 9px; border: 0; border-radius: 6px; color: var(--text); background: transparent; text-align: left; cursor: pointer; }
.manager-window-menu button:hover { background: var(--hover); }
.manager-window-menu-divider { height: 1px; margin: 3px 4px; background: var(--manager-border); }
.plugin-group-heading { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 0 calc(var(--manager-unit) * .75); margin: calc(var(--manager-unit) * 1.375) 0 calc(var(--manager-unit) * .5); border: 0; border-radius: calc(var(--manager-unit) * .375); color: var(--muted); background: transparent; font-size: var(--manager-font-small); font-weight: 600; text-align: left; cursor: pointer; }
.plugin-group-heading svg { width: calc(var(--manager-unit) * .9375); height: calc(var(--manager-unit) * .9375); transform: rotate(-90deg); }
.plugin-group-heading svg.is-expanded { transform: rotate(180deg); }
.plugin-subnav { display: grid; min-width: 0; gap: calc(var(--manager-unit) * .25); }
.plugin-subnav .nav-item > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-subnav .nav-item > svg, .plugin-subnav .nav-item img { width: calc(var(--manager-unit) * 1.125); height: calc(var(--manager-unit) * 1.125); flex: 0 0 calc(var(--manager-unit) * 1.125); }
.plugin-subnav .nav-item img { border-radius: calc(var(--manager-unit) * .25); object-fit: contain; }
.plugin-group-heading:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
@media (max-width: 680px) { .translation-handoff-banner { align-items: flex-start; flex-wrap: wrap; margin-inline: 16px; } .translation-handoff-banner > span { flex-basis: 100%; } }
</style>
