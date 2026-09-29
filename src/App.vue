<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ChevronDown, CircleHelp, Compass, Languages, LayoutGrid, Search, Settings2, SlidersHorizontal,
} from '@lucide/vue'
import logoDark from '@/assets/brand/logo-dark.svg'
import logoLight from '@/assets/brand/logo-light.svg'
import SearchView from './features/search/SearchView.vue'
import EntriesView from './features/entries/EntriesView.vue'
import TranslateView from './features/translate/TranslateView.vue'
import type { TranslationPrefillRequest } from './shared/domain'
import type { NativeManagerIntent } from './shared/ipc'

type Section = 'search' | 'entries' | 'translate' | 'settings'

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

const activeSection = ref<Section>('search')
const appsExpanded = ref(false)
const translationPrefill = ref<TranslationPrefillRequest | null>(null)
let removeTranslationPrefillListener: (() => void) | undefined
let removeNativeManagerIntentListener: (() => void) | undefined
const currentNativeRequestId = ref<string | null>(null)

const navItems: { id: Section; label: string; icon: typeof Search }[] = [
  { id: 'search', label: '快速搜索', icon: Search },
  { id: 'entries', label: '网址', icon: Compass },
]

const sectionLabel = computed(() => activeSection.value === 'translate'
  ? '翻译'
  : navItems.find((item) => item.id === activeSection.value)?.label ?? '设置')

function focusSearch(): void {
  activeSection.value = 'search'
  requestAnimationFrame(() => document.getElementById('quick-search')?.focus())
}

function navigateFromSearch(section: Exclude<Section, 'search'>): void {
  activeSection.value = section
  if (section === 'translate') appsExpanded.value = true
}

onMounted(() => {
  removeTranslationPrefillListener = window.desktop.onTranslationPrefill((request) => {
    currentNativeRequestId.value = null
    translationPrefill.value = request
    activeSection.value = 'translate'
    appsExpanded.value = true
  })
  removeNativeManagerIntentListener = window.desktop.onNativeManagerIntent((intent) => handleNativeManagerIntent(intent))
  window.desktop.managerReady()
})

onBeforeUnmount(() => {
  removeTranslationPrefillListener?.()
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
  activeSection.value = intent.section
  if (intent.section === 'translate') appsExpanded.value = true
  void nextTick().then(() => {
    if (currentNativeRequestId.value !== intent.requestId) return
    window.desktop.acknowledgeNativeManagerIntent(intent.requestId)
    currentNativeRequestId.value = null
  })
}

function handleTranslationPrefillApplied(id: string): void {
  if (translationPrefill.value?.id !== id) return
  if (currentNativeRequestId.value === id) {
    window.desktop.acknowledgeNativeManagerIntent(id)
    currentNativeRequestId.value = null
  } else {
    window.desktop.acknowledgeTranslationPrefill(id)
  }
  translationPrefill.value = null
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
          <span v-if="item.id === 'search'" class="nav-shortcut">Ctrl+Alt+Space</span>
        </button>
      </nav>
      <button class="nav-item nav-apps-trigger" :class="{ 'is-active': activeSection === 'translate' }" :aria-expanded="appsExpanded" aria-controls="apps-submenu" @click="appsExpanded = !appsExpanded">
        <LayoutGrid :size="17" :stroke-width="1.8" />
        <span>应用</span>
        <ChevronDown :size="14" class="nav-apps-chevron" :class="{ 'is-expanded': appsExpanded }" />
      </button>
      <nav id="apps-submenu" v-show="appsExpanded" class="nav-submenu" aria-label="应用">
        <button class="nav-item nav-subitem" :class="{ 'is-active': activeSection === 'translate' }" @click="activeSection = 'translate'">
          <Languages :size="15" :stroke-width="1.8" />
          <span>翻译</span>
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

      <SearchView v-if="activeSection === 'search'" @navigate="navigateFromSearch" />
      <EntriesView v-else-if="activeSection === 'entries'" class="entry-manager" />
      <SettingsView v-else-if="activeSection === 'settings'" />
      <TranslateView v-else-if="activeSection === 'translate'" :prefill="translationPrefill" @settings="activeSection = 'settings'" @prefill-applied="handleTranslationPrefillApplied" />

      <section v-else class="section-placeholder">
        <div class="section-symbol">
          <Languages :size="24" />
        </div>
        <p class="eyebrow">{{ sectionLabel }}</p>
        <h1>{{ sectionLabel }}</h1>
        <p>这里会呈现你的个人内容，先从搜索框开始使用 WebTools。</p>
        <button class="back-search" @click="focusSearch"><Search :size="16" /> 回到快速搜索</button>
      </section>
    </main>
  </div>
</template>
