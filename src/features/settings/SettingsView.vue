<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, Globe, Search } from '@lucide/vue'
import type { AppSettings, SearchProvider } from '@/shared/domain'

const settings = ref<AppSettings>({ defaultSearchProvider: 'google', aiBaseUrl: '', aiModel: '' })
const saved = ref(false)
const errorMessage = ref('')
const options: { id: SearchProvider; name: string; detail: string; icon: string }[] = [
  { id: 'google', name: 'Google', detail: '全球网页搜索', icon: 'G' },
  { id: 'baidu', name: '百度', detail: '中文网页搜索', icon: '百' },
  { id: 'bilibili', name: 'Bilibili', detail: '视频与创作内容', icon: 'B' },
]

async function choose(provider: SearchProvider): Promise<void> {
  const result = await window.desktop.updateSettings({ defaultSearchProvider: provider })
  if (result.ok) {
    settings.value = result.data
    saved.value = true
    errorMessage.value = ''
    window.setTimeout(() => { saved.value = false }, 1800)
  } else errorMessage.value = result.error.message
}

onMounted(async () => { settings.value = await window.desktop.getSettings() })
</script>

<template>
  <section class="content-page settings-page">
    <div class="page-heading"><div><p class="eyebrow">偏好与连接</p><h1>设置</h1><p class="page-description">调整 Nook 的搜索方式与服务连接。</p></div></div>
    <div class="settings-group">
      <div class="settings-group-heading"><span class="settings-group-icon"><Search :size="17" /></span><div><strong>网页搜索</strong><p>输入 ?关键词 时默认打开的平台</p></div></div>
      <button v-for="option in options" :key="option.id" class="provider-option" :class="{ selected: settings.defaultSearchProvider === option.id }" @click="choose(option.id)">
        <span class="provider-logo">{{ option.icon }}</span><span class="provider-copy"><strong>{{ option.name }}</strong><small>{{ option.detail }}</small></span><span v-if="settings.defaultSearchProvider === option.id" class="selected-check"><Check :size="15" /></span>
      </button>
    </div>
    <div class="settings-group future-settings"><div class="settings-group-heading"><span class="settings-group-icon"><Globe :size="17" /></span><div><strong>AI 翻译服务</strong><p>配置 OpenAI 或 DeepSeek 兼容接口</p></div></div><p class="settings-note">翻译设置将在 AI 翻译模块中开放。</p></div>
    <p v-if="saved" class="save-indicator"><Check :size="14" /> 已保存</p><p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
  </section>
</template>
