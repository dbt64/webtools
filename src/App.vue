<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CircleHelp, Command, Compass, Languages, Search, Settings2, SlidersHorizontal,
} from '@lucide/vue'
import SearchView from './features/search/SearchView.vue'
import EntriesView from './features/entries/EntriesView.vue'
import SettingsView from './features/settings/SettingsView.vue'
import TranslateView from './features/translate/TranslateView.vue'

type Section = 'search' | 'entries' | 'translate' | 'settings'

const activeSection = ref<Section>('search')

const navItems: { id: Section; label: string; icon: typeof Search }[] = [
  { id: 'search', label: '快速搜索', icon: Search },
  { id: 'entries', label: '网址', icon: Compass },
  { id: 'translate', label: '翻译', icon: Languages },
]

const sectionLabel = computed(() => navItems.find((item) => item.id === activeSection.value)?.label ?? '设置')

function focusSearch(): void {
  activeSection.value = 'search'
  requestAnimationFrame(() => document.getElementById('quick-search')?.focus())
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    focusSearch()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <div class="app-frame">
    <aside class="sidebar">
      <div class="brand-lockup">
        <div class="brand-mark"><Command :size="19" :stroke-width="2.4" /></div>
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
          <span v-if="item.id === 'search'" class="nav-shortcut">Ctrl K</span>
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

      <SearchView v-if="activeSection === 'search'" @navigate="activeSection = $event" />
      <EntriesView v-else-if="activeSection === 'entries'" class="entry-manager" />
      <SettingsView v-else-if="activeSection === 'settings'" />
      <TranslateView v-else-if="activeSection === 'translate'" @settings="activeSection = 'settings'" />

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
