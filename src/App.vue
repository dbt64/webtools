<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ChevronDown, CircleHelp, Compass, Languages, LayoutGrid, Puzzle, Settings2, SlidersHorizontal,
} from '@lucide/vue'
import logoDark from '@/assets/brand/logo-dark.svg'
import logoLight from '@/assets/brand/logo-light.svg'
import FavoritesView from './features/favorites/FavoritesView.vue'
import BuiltinTranslationGate from './features/plugins/BuiltinTranslationGate.vue'
import { builtinPluginPage } from './features/plugins/builtin-plugin-pages.ts'
import type { TranslationPrefillRequest } from './shared/domain'
import type { NativeManagerIntent } from './shared/ipc'
import type { BuiltinTranslationHandoffProjection, TranslationHandoffDisposition } from './shared/builtin-translation-contracts.ts'
import type { PluginPageDTO } from './shared/plugin-contracts.ts'
import type { CatalogEntryDTO, PluginRef } from './shared/plugin-catalog-contracts.ts'
import { catalogCanOpen, catalogKey, catalogNavigationItems, catalogPresentation, catalogShouldReturnToCenter, isCurrentCatalogRequest } from './features/plugins/catalog-view-model.ts'

const TranslateView = builtinPluginPage('translation')

type Section = 'favorites' | 'translate' | 'translation-gate' | 'settings' | 'plugins' | 'plugin-page'

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
const PluginLoading = createPluginLoadState('正在加载插件管理中心…')
const DeclarativeLoading = createPluginLoadState('正在打开插件页面…')
const PluginManagerView = defineAsyncComponent({ loader: () => import('./features/plugins/PluginManagerView.vue'), loadingComponent: PluginLoading, delay: 0 })
const DeclarativePluginView = defineAsyncComponent({ loader: () => import('./features/plugins/DeclarativePluginView.vue'), loadingComponent: DeclarativeLoading, delay: 0 })

const activeSection = ref<Section>('favorites')
const appsExpanded = ref(false)
const catalogEntries = ref<CatalogEntryDTO[]>([])
const pluginsLoading = ref(false)
const pluginsError = ref('')
const activePluginRef = ref<PluginRef | null>(null)
const activePluginPage = ref<PluginPageDTO | null>(null)
const pluginPageLoading = ref(false)
const pluginPageError = ref('')
const pluginNavItems = computed(() => catalogNavigationItems(catalogEntries.value))
const activeEntry = computed(() => activePluginRef.value ? catalogEntries.value.find(entry => catalogKey(entry) === catalogKey(activePluginRef.value!)) : undefined)
const activePluginName = computed(() => activeEntry.value ? catalogPresentation(activeEntry.value).name : '插件')
let catalogRevision = -1
let disposed = false
let pluginRefreshGeneration = 0
let pluginPageGeneration = 0
const translationPrefill = ref<TranslationPrefillRequest | null>(null)
const translationHandoff = ref<BuiltinTranslationHandoffProjection>({ status: 'none', uiGeneration: 0 })
const handoffBusy = ref(false)
const handoffError = ref('')
let removeNativeManagerIntentListener: (() => void) | undefined
const currentNativeRequestId = ref<string | null>(null)
const latestTranslationHandoffRequestId = ref<string | null>(null)
let handoffRefreshGeneration = 0

const navItems: { id: Section; label: string; icon: typeof Compass }[] = [
  { id: 'favorites', label: '网址', icon: Compass },
]

const sectionLabel = computed(() => activeSection.value === 'translate'
  ? '翻译'
  : activeSection.value === 'translation-gate'
    ? '翻译'
  : activeSection.value === 'plugins'
    ? '插件管理'
    : activeSection.value === 'plugin-page'
      ? activePluginName.value
  : navItems.find((item) => item.id === activeSection.value)?.label ?? '设置')

onMounted(() => {
  removeNativeManagerIntentListener = window.desktop.onNativeManagerIntent((intent) => handleNativeManagerIntent(intent))
  window.desktop.managerReady()
  void refreshPlugins()
})

onBeforeUnmount(() => {
  disposed = true
  pluginRefreshGeneration += 1
  pluginPageGeneration += 1
  removeNativeManagerIntentListener?.()
})

function handleNativeManagerIntent(intent: NativeManagerIntent): void {
  if (intent.kind === 'translation-handoff') {
    currentNativeRequestId.value = null
    latestTranslationHandoffRequestId.value = intent.requestId
    translationHandoff.value = { status: 'none', uiGeneration: 0 }
    translationPrefill.value = null
    handoffError.value = ''
    activeSection.value = 'translation-gate'
    appsExpanded.value = true
    void refreshTranslationHandoff(true, intent.requestId)
    return
  }

  latestTranslationHandoffRequestId.value = null
  handoffRefreshGeneration += 1
  translationHandoff.value = { status: 'none', uiGeneration: 0 }
  translationPrefill.value = null
  currentNativeRequestId.value = intent.requestId
  if (intent.kind === 'open-plugin') {
    activeSection.value = 'plugins'
    appsExpanded.value = true
    void (async () => {
      if (!await refreshPlugins() || disposed || currentNativeRequestId.value !== intent.requestId || activeSection.value !== 'plugins') return
      await openPluginPage(intent.ref)
      await nextTick()
      if (!disposed && currentNativeRequestId.value === intent.requestId) {
        window.desktop.acknowledgeNativeManagerIntent(intent.requestId)
        currentNativeRequestId.value = null
      }
    })()
    return
  }
  const targetSection: Section = intent.section === 'entries' ? 'favorites' : intent.section
  activeSection.value = targetSection
  void nextTick().then(() => {
    if (currentNativeRequestId.value !== intent.requestId) return
    window.desktop.acknowledgeNativeManagerIntent(intent.requestId)
    currentNativeRequestId.value = null
  })
}

function handleTranslationPrefillApplied(id: string): void {
  if (translationPrefill.value?.id !== id) return
  const handoff = translationHandoff.value
  if (handoff.status !== 'ready' || handoff.requestId !== id || handoff.text === null) return
  void resolveTranslationHandoff(handoff, 'applied', false)
}

function handleTranslationPageReady(): void {
  const handoff = translationHandoff.value
  if (handoff.status === 'ready' && handoff.text === null) void resolveTranslationHandoff(handoff, 'applied', false)
}

async function refreshTranslationHandoff(navigate: boolean, expectedRequestId?: string): Promise<void> {
  const generation = ++handoffRefreshGeneration
  try {
    const result = await window.desktop.builtinTranslationHandoff.get()
    if (disposed || generation !== handoffRefreshGeneration) return
    if (!result.ok) { handoffError.value = result.error.message; return }
    const projection = result.data
    if (expectedRequestId && projection.status !== 'none' && projection.requestId !== expectedRequestId) return
    translationHandoff.value = projection
    handoffError.value = ''
    if (navigate) navigateToHandoffProjection(projection)
    else if (activeSection.value === 'translation-gate' && projection.status === 'ready') {
      activeSection.value = 'plugins'
      appsExpanded.value = true
    } else if (projection.status === 'none' && latestTranslationHandoffRequestId.value) {
      latestTranslationHandoffRequestId.value = null
      if (activeSection.value === 'translation-gate') activeSection.value = 'favorites'
    }
  } catch {
    if (!disposed && generation === handoffRefreshGeneration) handoffError.value = '无法读取翻译交接状态，请重试。'
  }
}

function navigateToHandoffProjection(projection: BuiltinTranslationHandoffProjection): void {
  if (projection.status === 'blocked') {
    translationPrefill.value = null
    activeSection.value = 'translation-gate'
    return
  }
  if (projection.status === 'ready') {
    translationPrefill.value = projection.text === null ? null : { id: projection.requestId, text: projection.text }
    activeSection.value = 'translate'
    appsExpanded.value = true
    return
  }
  latestTranslationHandoffRequestId.value = null
  handoffError.value = '翻译请求已结束，请重新打开。'
  activeSection.value = 'plugins'
  appsExpanded.value = true
}

async function resolveTranslationHandoff(
  handoff: Exclude<BuiltinTranslationHandoffProjection, { status: 'none' }>,
  disposition: TranslationHandoffDisposition,
  navigateWhenReady: boolean,
): Promise<void> {
  if (handoffBusy.value) return
  handoffBusy.value = true
  handoffError.value = ''
  try {
    const result = await window.desktop.builtinTranslationHandoff.resolve({
      requestId: handoff.requestId,
      generation: handoff.generation,
      uiGeneration: handoff.uiGeneration,
      disposition,
    })
    const current = translationHandoff.value
    if (current.status === 'none' || current.requestId !== handoff.requestId || current.generation !== handoff.generation) return
    if (!result.ok) {
      const message = result.error.message
      await refreshTranslationHandoff(false)
      handoffError.value = message
      return
    }
    translationHandoff.value = result.data
    if (disposition === 'cancel' || (disposition === 'applied' && result.data.status === 'none')) {
      latestTranslationHandoffRequestId.value = null
      translationPrefill.value = null
      handoffError.value = ''
      if (activeSection.value === 'translation-gate') activeSection.value = 'favorites'
      return
    }
    if (disposition === 'enable-and-open' && result.data.status === 'ready') {
      const refreshed = await refreshPlugins()
      const latest = translationHandoff.value
      if (disposed || latest.status === 'none' || latest.requestId !== handoff.requestId || latest.generation !== handoff.generation) return
      if (!refreshed || !catalogEntries.value.some(entry => entry.kind === 'builtin' && entry.id === 'webtools.translation' && catalogCanOpen(entry))) {
        handoffError.value = '翻译已启用，但插件目录暂时无法刷新。请重试读取目录后继续。'
        activeSection.value = 'plugins'
        return
      }
    }
    if (navigateWhenReady && result.data.status !== 'none') navigateToHandoffProjection(result.data)
  } catch {
    handoffError.value = '翻译操作没有完成，请重试。'
  } finally { handoffBusy.value = false }
}

function handleHandoffPresented(handoff: Extract<BuiltinTranslationHandoffProjection, { status: 'blocked' }>): void {
  void resolveTranslationHandoff(handoff, 'gate-presented', false)
}

function enableAndOpenTranslation(handoff: Extract<BuiltinTranslationHandoffProjection, { status: 'blocked' }>): void {
  void resolveTranslationHandoff(handoff, 'enable-and-open', true)
}

function cancelTranslationHandoff(handoff: Exclude<BuiltinTranslationHandoffProjection, { status: 'none' }>): void {
  void resolveTranslationHandoff(handoff, 'cancel', false)
}

function manageTranslationHandoff(): void {
  activeSection.value = 'plugins'
  appsExpanded.value = true
}

function resumeTranslationHandoff(): void {
  const requestId = translationHandoff.value.status === 'none' ? undefined : translationHandoff.value.requestId
  void refreshTranslationHandoff(true, requestId)
}

async function handlePluginCenterChanged(): Promise<void> {
  await refreshPlugins()
  if (translationHandoff.value.status !== 'none') await refreshTranslationHandoff(false)
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
    if (result.data.declarativeAvailability.status === 'unavailable') pluginsError.value = '第三方插件暂时无法读取；内置翻译仍可使用。请重试。'
    if (activeSection.value === 'translate') {
      const translationEntry = result.data.entries.find(entry => entry.kind === 'builtin' && entry.id === 'webtools.translation')
      if (!translationEntry || !catalogCanOpen(translationEntry)) returnToPluginCenter()
    }
    if (activeSection.value === 'plugin-page' && catalogShouldReturnToCenter(activePluginRef.value, result.data.entries)) returnToPluginCenter()
    return true
  } catch { if (!disposed && generation === pluginRefreshGeneration) pluginsError.value = '无法读取插件目录，请重试。'; return false }
  finally { if (!disposed && generation === pluginRefreshGeneration) pluginsLoading.value = false }
}

async function openPluginPage(ref: PluginRef): Promise<void> {
  const generation = ++pluginPageGeneration
  const entry = catalogEntries.value.find(item => catalogKey(item) === catalogKey(ref))
  if (!entry || !catalogCanOpen(entry)) { returnToPluginCenter(); return }
  // Preserve the original Translation mount (input/results/pending request) on repeat navigation.
  if (ref.kind === 'builtin' && activeSection.value === 'translate') return
  activePluginRef.value = { ...ref }
  activePluginPage.value = null
  pluginPageError.value = ''
  pluginPageLoading.value = true
  appsExpanded.value = true
  activeSection.value = 'plugin-page'
  const current = () => !disposed && isCurrentCatalogRequest({ section: activeSection.value, ref: activePluginRef.value, generation: pluginPageGeneration }, { section: 'plugin-page', ref, generation })
  try {
    const result = await window.desktop.pluginCatalog.open({ ...ref })
    if (!current()) return
    if (!result.ok) { pluginPageError.value = result.error.message; pluginPageLoading.value = false; void refreshPlugins(); return }
    const latest = catalogEntries.value.find(item => catalogKey(item) === catalogKey(ref))
    if (!latest || !catalogCanOpen(latest)) { returnToPluginCenter(); void refreshPlugins(); return }
    if (result.data.kind === 'builtin') {
      if (ref.kind !== 'builtin' || latest.kind !== 'builtin' || result.data.id !== ref.id || result.data.key !== latest.entry.key) { returnToPluginCenter(); return }
      activeSection.value = 'translate'
      pluginPageLoading.value = false
      return
    }
    const page = result.data.page
    if (ref.kind !== 'declarative' || latest.kind !== 'declarative' || page.pluginId !== ref.id || page.version !== latest.package.version || page.hash !== latest.package.hash) {
      returnToPluginCenter(); void refreshPlugins(); return
    }
    activePluginPage.value = page
    pluginPageLoading.value = false
  } catch {
    if (!current()) return
    pluginPageError.value = '插件页面暂时无法加载，请重试。'
    pluginPageLoading.value = false
    void refreshPlugins()
  }
}

function returnToPluginCenter(): void {
  pluginPageGeneration += 1
  activePluginRef.value = null
  activePluginPage.value = null
  pluginPageLoading.value = false
  pluginPageError.value = ''
  activeSection.value = 'plugins'
  appsExpanded.value = true
}

</script>

<template>
  <div class="app-frame">
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
          @click="activeSection = item.id"
        >
          <component :is="item.icon" :size="17" :stroke-width="1.8" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <button class="nav-item nav-apps-trigger" :class="{ 'is-active': activeSection === 'translate' || activeSection === 'translation-gate' || activeSection === 'plugins' || activeSection === 'plugin-page' }" :aria-expanded="appsExpanded" aria-controls="apps-submenu" @click="appsExpanded = !appsExpanded">
        <LayoutGrid :size="17" :stroke-width="1.8" />
        <span>插件</span>
        <ChevronDown :size="14" class="nav-apps-chevron" :class="{ 'is-expanded': appsExpanded }" />
      </button>
      <nav id="apps-submenu" v-show="appsExpanded" class="nav-submenu" aria-label="插件">
        <button v-for="item in pluginNavItems" :key="item.key" class="nav-item nav-subitem plugin-nav-item" :class="{ 'is-active': item.ref.kind === 'builtin' ? activeSection === 'translate' : activeSection === 'plugin-page' && activePluginRef && catalogKey(activePluginRef) === item.key }" :title="item.label" @click="openPluginPage(item.ref)">
          <Languages v-if="item.icon.kind === 'host'" :size="15" :stroke-width="1.8" /><img v-else-if="item.icon.kind === 'png'" :src="item.icon.dataUrl" alt="" /><Puzzle v-else :size="14" :stroke-width="1.8" />
          <span>{{ item.label }}</span>
        </button>
        <button class="nav-item nav-subitem" :class="{ 'is-active': activeSection === 'plugins' }" @click="returnToPluginCenter">
          <Puzzle :size="15" :stroke-width="1.8" />
          <span>插件管理</span>
        </button>
      </nav>

      <div class="sidebar-bottom">
        <button class="nav-item" :class="{ 'is-active': activeSection === 'settings' }" @click="activeSection = 'settings'">
          <Settings2 :size="17" :stroke-width="1.8" />
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
        <div class="breadcrumb"><span>工作区</span><span class="breadcrumb-slash">/</span><strong>{{ sectionLabel }}</strong></div>
        <button class="help-button" aria-label="帮助"><CircleHelp :size="17" /></button>
      </header>

      <aside v-if="translationHandoff.status !== 'none' && activeSection !== 'translate' && activeSection !== 'translation-gate'" class="translation-handoff-banner" role="status" aria-live="polite">
        <span>{{ translationHandoff.status === 'ready' ? '有一条待处理的翻译请求。' : '翻译请求仍由 WebTools 保留。' }}</span>
        <button class="secondary-button" :disabled="handoffBusy" @click="resumeTranslationHandoff">继续翻译</button>
        <button class="text-button" :disabled="handoffBusy" @click="cancelTranslationHandoff(translationHandoff)">丢弃</button>
      </aside>

      <BuiltinTranslationGate
        v-if="activeSection === 'translation-gate' && translationHandoff.status === 'blocked'"
        :key="`${translationHandoff.requestId}:${translationHandoff.generation}:${translationHandoff.uiGeneration}`"
        :handoff="translationHandoff"
        :busy="handoffBusy"
        :error="handoffError"
        @presented="handleHandoffPresented"
        @enable-and-open="enableAndOpenTranslation"
        @cancel="cancelTranslationHandoff"
        @manage="manageTranslationHandoff"
      />
      <section v-else-if="activeSection === 'translation-gate'" class="content-page settings-load-state" role="status" aria-live="polite">
        <div class="page-heading"><div><p class="eyebrow">应用扩展</p><h1>翻译</h1><p class="page-description">{{ handoffError || '正在读取翻译状态…' }}</p></div></div>
        <button v-if="handoffError" class="secondary-button" :disabled="handoffBusy" @click="resumeTranslationHandoff">重试</button>
      </section>

      <FavoritesView v-if="activeSection === 'favorites'" />
      <SettingsView v-else-if="activeSection === 'settings'" />
      <TranslateView v-else-if="activeSection === 'translate'" :prefill="translationPrefill" @settings="activeSection = 'settings'" @prefill-applied="handleTranslationPrefillApplied" @page-ready="handleTranslationPageReady" />
      <PluginManagerView v-else-if="activeSection === 'plugins'" :entries="catalogEntries" :loading="pluginsLoading" :error="pluginsError" @retry="refreshPlugins" @changed="handlePluginCenterChanged" @open-plugin="openPluginPage" />
      <DeclarativePluginView v-else-if="activeSection === 'plugin-page' && activePluginPage" :page="activePluginPage" :plugin-name="activePluginName" @leave="returnToPluginCenter" />
      <section v-else-if="activeSection === 'plugin-page'" class="content-page settings-load-state" role="status" aria-live="polite">
        <div class="page-heading"><div><p class="eyebrow">插件页面</p><h1>{{ activePluginName }}</h1><p class="page-description" :role="pluginPageError ? 'alert' : 'status'">{{ pluginPageError || (pluginPageLoading ? '正在载入声明式页面…' : '页面当前不可用。') }}</p></div></div>
        <button v-if="pluginPageError && activePluginRef" class="secondary-button" @click="openPluginPage(activePluginRef!)">重试</button><button class="secondary-button" @click="returnToPluginCenter">返回插件管理</button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.translation-handoff-banner { display: flex; align-items: center; gap: 10px; padding: 9px 12px; margin: 0 30px 12px; border-radius: 8px; color: var(--text); background: var(--surface); font-size: 10px; }
.translation-handoff-banner > span { min-width: 0; flex: 1; color: var(--muted); }
.translation-handoff-banner .secondary-button { min-height: 30px; padding: 0 9px; }
.translation-handoff-banner .text-button { flex: 0 0 auto; }
@media (max-width: 680px) { .translation-handoff-banner { align-items: flex-start; flex-wrap: wrap; margin-inline: 16px; } .translation-handoff-banner > span { flex-basis: 100%; } }
</style>
