<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, Globe, KeyRound, Search } from '@lucide/vue'
import type { AppSettings, SearchProvider } from '@/shared/domain'

const settings = ref<AppSettings>({ defaultSearchProvider: 'google', aiBaseUrl: '', aiModel: '' })
const saved = ref(false)
const errorMessage = ref('')
const apiKey = ref('')
const hasSavedKey = ref(false)
const testing = ref(false)
const testMessage = ref('')
const options: { id: SearchProvider; name: string; detail: string; icon: string }[] = [
  { id: 'google', name: 'Google', detail: '全球网页搜索', icon: 'G' },
  { id: 'baidu', name: '百度', detail: '中文网页搜索', icon: '百' },
  { id: 'bilibili', name: 'Bilibili', detail: '视频与创作内容', icon: 'B' },
]

async function choose(provider: SearchProvider): Promise<void> {
  const currentAiSettings = { aiBaseUrl: settings.value.aiBaseUrl, aiModel: settings.value.aiModel }
  const result = await window.desktop.updateSettings({ defaultSearchProvider: provider })
  if (result.ok) {
    settings.value = { ...result.data, ...currentAiSettings }
    saved.value = true
    errorMessage.value = ''
    window.setTimeout(() => { saved.value = false }, 1800)
  } else errorMessage.value = result.error.message
}

async function saveAiSettings(): Promise<boolean> {
  const result = await window.desktop.updateSettings({ aiBaseUrl: settings.value.aiBaseUrl.trim(), aiModel: settings.value.aiModel.trim() })
  if (!result.ok) { errorMessage.value = result.error.message; return false }
  settings.value = result.data
  if (apiKey.value.trim()) {
    const keyResult = await window.desktop.saveAiApiKey(apiKey.value.trim())
    if (!keyResult.ok) { errorMessage.value = keyResult.error.message; return false }
    hasSavedKey.value = true
    apiKey.value = ''
  }
  saved.value = true
  errorMessage.value = ''
  window.setTimeout(() => { saved.value = false }, 1800)
  return true
}

async function testConnection(): Promise<void> {
  testing.value = true
  testMessage.value = ''
  try {
    if (!await saveAiSettings()) return
    const result = await window.desktop.testAiConnection()
    testMessage.value = result.ok ? `已连接 · ${result.data.model}` : result.error.message
  } catch {
    testMessage.value = '无法连接 AI 服务，请检查网络和设置。'
  } finally {
    testing.value = false
  }
}

async function clearKey(): Promise<void> {
  if (!window.confirm('删除已保存的 API Key？')) return
  const result = await window.desktop.clearAiApiKey()
  if (!result.ok) errorMessage.value = result.error.message
  else { hasSavedKey.value = false; errorMessage.value = ''; testMessage.value = '已删除 API Key。' }
}

onMounted(async () => {
  try {
    settings.value = await window.desktop.getSettings()
    hasSavedKey.value = await window.desktop.hasAiApiKey()
  } catch {
    errorMessage.value = '无法读取本机设置。'
  }
})
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
    <div class="settings-group ai-settings">
      <div class="settings-group-heading"><span class="settings-group-icon"><KeyRound :size="17" /></span><div><strong>AI 翻译服务</strong><p>OpenAI 兼容接口 · 支持 OpenAI、DeepSeek</p></div></div>
      <label class="field-label">服务地址<input v-model="settings.aiBaseUrl" placeholder="https://api.openai.com/v1 或 https://api.deepseek.com" /></label>
      <label class="field-label">模型名称<input v-model="settings.aiModel" placeholder="例如：gpt-4o-mini 或 deepseek-chat" /></label>
      <label class="field-label">API Key<input v-model="apiKey" type="password" autocomplete="new-password" :placeholder="hasSavedKey ? '已安全保存；输入新值可替换' : '输入 API Key'" /></label>
      <p class="secret-note">API Key 使用 Windows 安全存储加密，不会写入普通设置文件。连接测试会发送一次简短请求。</p>
      <div class="ai-settings-actions"><button class="primary-button" @click="saveAiSettings">保存设置</button><button class="secondary-button" :disabled="testing" @click="testConnection">{{ testing ? '正在连接…' : '测试连接' }}</button><button v-if="hasSavedKey" class="text-button remove-key" @click="clearKey">移除已保存的 Key</button></div>
      <p v-if="testMessage" class="settings-result">{{ testMessage }}</p>
    </div>
    <p v-if="saved" class="save-indicator"><Check :size="14" /> 已保存</p><p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
  </section>
</template>
