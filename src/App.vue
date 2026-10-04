<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ChevronDown, CircleHelp, Compass, Languages, LayoutGrid, Puzzle, Settings2, SlidersHorizontal,
} from '@lucide/vue'
import logoDark from '@/assets/brand/logo-dark.svg'
import logoLight from '@/assets/brand/logo-light.svg'
import FavoritesView from './features/favorites/FavoritesView.vue'
import TranslateView from './features/translate/TranslateView.vue'
import type { TranslationPrefillRequest } from './shared/domain'
import type { NativeManagerIntent } from './shared/ipc'
import type { PluginPageDTO, PluginSummary } from './shared/plugin-contracts.ts'
import { pluginCanOpen } from './features/plugins/plugin-view-model.ts'
import { isCurrentPluginPageRequest, pluginNavigationItems, shouldReturnToPluginCenter } from './features/plugins/plugin-navigation.ts'

type Section = 'favorites' | 'translate' | 'settings' | 'plugins' | 'plugin-page'

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
const pluginSummaries = ref<PluginSummary[]>([])
const pluginsLoading = ref(false)
const pluginsError = ref('')
const activePluginId = ref<string | null>(null)
const activePluginPage = ref<PluginPageDTO | null>(null)
const pluginPageLoading = ref(false)
const pluginPageError = ref('')
const pluginNavItems = computed(() => pluginNavigationItems(pluginSummaries.value))
let pluginRefreshGeneration = 0
let pluginPageGeneration = 0
const translationPrefill = ref<TranslationPrefillRequest | null>(null)
let removeNativeManagerIntentListener: (() => void) | undefined
const currentNativeRequestId = ref<string | null>(null)

const navItems: { id: Section; label: string; icon: typeof Compass }[] = [
  { id: 'favorites', label: '网址', icon: Compass },
]

const sectionLabel = computed(() => activeSection.value === 'translate'
  ? '翻译'
  : activeSection.value === 'plugins'
    ? '插件'
    : activeSection.value === 'plugin-page'
      ? pluginSummaries.value.find(plugin => plugin.id === activePluginId.value)?.name ?? '插件'
  : navItems.find((item) => item.id === activeSection.value)?.label ?? '设置')

onMounted(() => {
  removeNativeManagerIntentListener = window.desktop.onNativeManagerIntent((intent) => handleNativeManagerIntent(intent))
  window.desktop.managerReady()
  void refreshPlugins()
})

onBeforeUnmount(() => {
  removeNativeManagerIntentListener?.()
})

function handleNativeManagerIntent(intent: NativeManagerIntent): void {
  currentNativeRequestId.value = intent.requestId
  if (intent.kind === 'translation-prefill') {
    translationPrefill.value = { id: intent.requestId, text: intent.text }
    activeSection.value = 'translate'
    appsExpanded.value = true
    return
  }

  translationPrefill.value = null
  const targetSection: Section = intent.section === 'entries' ? 'favorites' : intent.section
  activeSection.value = targetSection
  if (targetSection === 'translate') appsExpanded.value = true
  void nextTick().then(() => {
    if (currentNativeRequestId.value !== intent.requestId) return
    window.desktop.acknowledgeNativeManagerIntent(intent.requestId)
    currentNativeRequestId.value = null
  })
}

function handleTranslationPrefillApplied(id: string): void {
  if (translationPrefill.value?.id !== id) return
  if (currentNativeRequestId.value === id) window.desktop.acknowledgeNativeManagerIntent(id)
  currentNativeRequestId.value = null
  translationPrefill.value = null
}

async function refreshPlugins(): Promise<void> {
  const generation = ++pluginRefreshGeneration
  pluginsLoading.value = true
  pluginsError.value = ''
  try {
    const result = await window.desktop.plugins.list()
    if (generation !== pluginRefreshGeneration) return
    if (!result.ok) { pluginsError.value = result.error.message; return }
    pluginSummaries.value = result.data
    if (activeSection.value === 'plugin-page' && shouldReturnToPluginCenter(activePluginId.value, result.data)) returnToPluginCenter()
  } catch { if (generation === pluginRefreshGeneration) pluginsError.value = '无法读取已安装插件，请重试。' }
  finally { if (generation === pluginRefreshGeneration) pluginsLoading.value = false }
}

async function openPluginPage(pluginId: string): Promise<void> {
  const generation = ++pluginPageGeneration
  const summary = pluginSummaries.value.find(plugin => plugin.id === pluginId)
  if (!summary || !pluginCanOpen(summary)) { returnToPluginCenter(); return }
  activePluginId.value = pluginId
  activePluginPage.value = null
  pluginPageError.value = ''
  pluginPageLoading.value = true
  appsExpanded.value = true
  activeSection.value = 'plugin-page'
  try {
    const result = await window.desktop.plugins.getPages(pluginId)
    if (!isCurrentPluginPageRequest({ section: activeSection.value, pluginId: activePluginId.value, generation: pluginPageGeneration }, { section: 'plugin-page', pluginId, generation })) return
    if (!result.ok) { pluginPageError.value = result.error.message; pluginPageLoading.value = false; void refreshPlugins(); return }
    const latest = pluginSummaries.value.find(plugin => plugin.id === pluginId)
    if (!latest || !pluginCanOpen(latest) || result.data.pluginId !== pluginId || result.data.version !== latest.version || result.data.hash !== latest.hash) {
      returnToPluginCenter(); void refreshPlugins(); return
    }
    activePluginPage.value = result.data
    pluginPageLoading.value = false
  } catch {
    if (!isCurrentPluginPageRequest({ section: activeSection.value, pluginId: activePluginId.value, generation: pluginPageGeneration }, { section: 'plugin-page', pluginId, generation })) return
    pluginPageError.value = '插件页面暂时无法加载，请重试。'
    pluginPageLoading.value = false
  }
}

function returnToPluginCenter(): void {
  pluginPageGeneration += 1
  activePluginId.value = null
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
      <button class="nav-item nav-apps-trigger" :class="{ 'is-active': activeSection === 'translate' || activeSection === 'plugins' || activeSection === 'plugin-page' }" :aria-expanded="appsExpanded" aria-controls="apps-submenu" @click="appsExpanded = !appsExpanded">
        <LayoutGrid :size="17" :stroke-width="1.8" />
        <span>应用</span>
        <ChevronDown :size="14" class="nav-apps-chevron" :class="{ 'is-expanded': appsExpanded }" />
      </button>
      <nav id="apps-submenu" v-show="appsExpanded" class="nav-submenu" aria-label="应用">
        <button class="nav-item nav-subitem" :class="{ 'is-active': activeSection === 'translate' }" @click="activeSection = 'translate'">
          <Languages :size="15" :stroke-width="1.8" />
          <span>翻译</span>
        </button>
        <button class="nav-item nav-subitem" :class="{ 'is-active': activeSection === 'plugins' || activeSection === 'plugin-page' }" @click="returnToPluginCenter">
          <Puzzle :size="15" :stroke-width="1.8" />
          <span>插件</span>
        </button>
        <button v-for="item in pluginNavItems" :key="item.id" class="nav-item nav-subitem plugin-nav-item" :class="{ 'is-active': activeSection === 'plugin-page' && activePluginId === item.id }" :title="item.label" @click="openPluginPage(item.id)">
          <img v-if="item.iconDataUrl" :src="item.iconDataUrl" alt="" /><Puzzle v-else :size="14" :stroke-width="1.8" />
          <span>{{ item.label }}</span>
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

      <FavoritesView v-if="activeSection === 'favorites'" />
      <SettingsView v-else-if="activeSection === 'settings'" />
      <TranslateView v-else-if="activeSection === 'translate'" :prefill="translationPrefill" @settings="activeSection = 'settings'" @prefill-applied="handleTranslationPrefillApplied" />
      <PluginManagerView v-else-if="activeSection === 'plugins'" :plugins="pluginSummaries" :loading="pluginsLoading" :error="pluginsError" @retry="refreshPlugins" @changed="refreshPlugins" @open-plugin="openPluginPage" />
      <DeclarativePluginView v-else-if="activeSection === 'plugin-page' && activePluginPage" :page="activePluginPage" :plugin-name="pluginSummaries.find(plugin => plugin.id === activePluginId)?.name ?? activePluginPage.entry.label" @leave="returnToPluginCenter" />
      <section v-else-if="activeSection === 'plugin-page'" class="content-page settings-load-state" role="status" aria-live="polite">
        <div class="page-heading"><div><p class="eyebrow">插件页面</p><h1>{{ pluginSummaries.find(plugin => plugin.id === activePluginId)?.name ?? '插件' }}</h1><p class="page-description" :role="pluginPageError ? 'alert' : 'status'">{{ pluginPageError || (pluginPageLoading ? '正在载入声明式页面…' : '页面当前不可用。') }}</p></div></div>
        <button v-if="pluginPageError && activePluginId" class="secondary-button" @click="openPluginPage(activePluginId)">重试</button><button class="secondary-button" @click="returnToPluginCenter">返回插件管理</button>
      </section>
    </main>
  </div>
</template>
