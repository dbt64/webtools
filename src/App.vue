<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Bookmark, CircleHelp, Command, Compass, Languages, Search, Settings2, SlidersHorizontal,
  Sparkles, SquareArrowOutUpRight, Wrench,
} from '@lucide/vue'

type Section = 'search' | 'bookmarks' | 'entries' | 'translate' | 'settings'

const activeSection = ref<Section>('search')
const appVersion = ref('')
const searchText = ref('')
const searchInput = ref<HTMLInputElement>()

const navItems: { id: Section; label: string; icon: typeof Search }[] = [
  { id: 'search', label: '快速搜索', icon: Search },
  { id: 'bookmarks', label: '收藏夹', icon: Bookmark },
  { id: 'entries', label: '网址与工具', icon: Compass },
  { id: 'translate', label: '翻译', icon: Languages },
]

const sectionLabel = computed(() => navItems.find((item) => item.id === activeSection.value)?.label ?? '设置')

function focusSearch(): void {
  activeSection.value = 'search'
  requestAnimationFrame(() => searchInput.value?.focus())
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    focusSearch()
  }
}

onMounted(async () => {
  try {
    appVersion.value = await window.desktop.getVersion()
  } catch {
    appVersion.value = '开发预览'
  }
  window.addEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <div class="app-frame">
    <aside class="sidebar">
      <div class="brand-lockup">
        <div class="brand-mark"><Command :size="19" :stroke-width="2.4" /></div>
        <div>
          <div class="brand-name">Nook</div>
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
          <span v-if="item.id === 'search'" class="nav-shortcut">⌘ K</span>
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

      <section v-if="activeSection === 'search'" class="search-page">
        <div class="welcome-block">
          <div class="welcome-icon"><Sparkles :size="17" /></div>
          <p class="eyebrow">一处开始，随手可达</p>
          <h1>接下来要做什么？</h1>
          <p class="welcome-copy">搜索应用、打开常用网址，或者用 <kbd>?</kbd> 开始网页搜索。</p>
        </div>

        <label class="search-box" for="quick-search">
          <Search :size="20" class="search-icon" />
          <input
            id="quick-search"
            ref="searchInput"
            v-model="searchText"
            autocomplete="off"
            placeholder="搜索应用、网址或工具…"
            spellcheck="false"
          />
          <span class="search-hint"><kbd>Ctrl</kbd><kbd>K</kbd></span>
        </label>

        <div v-if="searchText" class="search-feedback">
          <template v-if="searchText.startsWith('?')">
            <span class="mode-chip"><Search :size="13" /> 网页搜索</span>
            <span>输入关键词后按 Enter 搜索</span>
          </template>
          <template v-else>
            <span class="mode-chip"><Command :size="13" /> 本地搜索</span>
            <span>应用目录扫描即将就绪</span>
          </template>
        </div>

        <div v-else class="quick-start">
          <div class="section-heading">
            <div><h2>快速开始</h2><p>常用动作，一键触达</p></div>
            <button class="text-button" @click="activeSection = 'entries'">管理入口 <SquareArrowOutUpRight :size="13" /></button>
          </div>
          <div class="quick-grid">
            <button class="quick-card" @click="activeSection = 'bookmarks'">
              <span class="quick-card-icon bookmark-icon"><Bookmark :size="17" /></span>
              <span class="quick-card-text"><strong>收藏网址</strong><small>整理稍后再看的页面</small></span>
              <span class="card-plus">+</span>
            </button>
            <button class="quick-card" @click="activeSection = 'translate'">
              <span class="quick-card-icon translate-icon"><Languages :size="17" /></span>
              <span class="quick-card-text"><strong>快速翻译</strong><small>AI 或 Google Translate</small></span>
              <span class="card-plus">+</span>
            </button>
            <button class="quick-card" @click="activeSection = 'entries'">
              <span class="quick-card-icon tools-icon"><Wrench :size="17" /></span>
              <span class="quick-card-text"><strong>常用工具</strong><small>管理网址和桌面工具</small></span>
              <span class="card-plus">+</span>
            </button>
          </div>
        </div>

        <footer class="search-footer">
          <span><i class="status-dot"></i> 本地优先</span>
          <span>搜索按键 <kbd>?</kbd> 可切换网页模式</span>
          <span>Nook {{ appVersion }}</span>
        </footer>
      </section>

      <section v-else class="section-placeholder">
        <div class="section-symbol">
          <Bookmark v-if="activeSection === 'bookmarks'" :size="24" />
          <Compass v-else-if="activeSection === 'entries'" :size="24" />
          <Languages v-else-if="activeSection === 'translate'" :size="24" />
          <Settings2 v-else :size="24" />
        </div>
        <p class="eyebrow">{{ sectionLabel }}</p>
        <h1>{{ sectionLabel }}</h1>
        <p>这里会呈现你的个人内容，先从搜索框开始使用 Nook。</p>
        <button class="back-search" @click="focusSearch"><Search :size="16" /> 回到快速搜索</button>
      </section>
    </main>
  </div>
</template>
