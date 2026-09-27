<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Copy, ExternalLink, Languages, Sparkles } from '@lucide/vue'
import type { TranslationPrefillRequest } from '@/shared/domain'

const emit = defineEmits<{ settings: [] }>()
const props = defineProps<{ prefill: TranslationPrefillRequest | null }>()
const sourceText = ref('')
const translation = ref('')
const targetLanguage = ref('zh-CN')
const loading = ref(false)
const errorMessage = ref('')
const copied = ref(false)
const canTranslate = computed(() => Boolean(sourceText.value.trim()) && !loading.value)
let contentGeneration = 0
const languages = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'fr', label: '法语' },
  { value: 'de', label: '德语' },
  { value: 'es', label: '西班牙语' },
]

watch(() => props.prefill?.id, () => {
  const prefill = props.prefill
  if (!prefill) return
  contentGeneration += 1
  sourceText.value = prefill.text
  translation.value = ''
  errorMessage.value = ''
  copied.value = false
  loading.value = false
}, { immediate: true })

async function translate(): Promise<void> {
  const generation = contentGeneration
  const text = sourceText.value
  loading.value = true
  errorMessage.value = ''
  translation.value = ''
  try {
    const result = await window.desktop.translateWithAi({ text, targetLanguage: targetLanguage.value })
    if (generation !== contentGeneration) return
    if (result.ok) translation.value = result.data.translation
    else errorMessage.value = result.error.message
  } catch {
    if (generation === contentGeneration) errorMessage.value = '翻译请求未能完成，请重试。'
  } finally {
    if (generation === contentGeneration) loading.value = false
  }
}

async function openGoogle(): Promise<void> {
  const generation = contentGeneration
  errorMessage.value = ''
  try {
    const result = await window.desktop.openGoogleTranslate({ text: sourceText.value, targetLanguage: targetLanguage.value })
    if (generation !== contentGeneration) return
    if (!result.ok) errorMessage.value = result.error.message
  } catch {
    if (generation === contentGeneration) errorMessage.value = '无法打开 Google Translate，请重试。'
  }
}

async function copyResult(): Promise<void> {
  const generation = contentGeneration
  try {
    await navigator.clipboard.writeText(translation.value)
    if (generation !== contentGeneration) return
    copied.value = true
    window.setTimeout(() => { if (generation === contentGeneration) copied.value = false }, 1500)
  } catch {
    if (generation === contentGeneration) errorMessage.value = '无法访问剪贴板，请手动复制译文。'
  }
}
</script>

<template>
  <section class="content-page translate-page">
    <div class="page-heading"><div><p class="eyebrow">快速理解一段文字</p><h1>翻译</h1><p class="page-description">使用已配置的 AI 接口翻译，或在浏览器中打开 Google Translate。</p></div></div>
    <div class="translation-toolbar"><span class="language-label"><Languages :size="15" /> 自动识别</span><span class="language-arrow">→</span><select v-model="targetLanguage" aria-label="目标语言"><option v-for="language in languages" :key="language.value" :value="language.value">{{ language.label }}</option></select></div>
    <div class="translation-columns">
      <label class="translation-pane"><span class="pane-heading">原文 <small>{{ sourceText.length }} / 20,000</small></span><textarea v-model="sourceText" maxlength="20000" placeholder="输入或粘贴要翻译的文字…"></textarea><span class="pane-foot">文字仅在你点击翻译时发送给已配置的 AI 服务。</span></label>
      <div class="translation-pane output-pane"><div class="pane-heading">译文 <button v-if="translation" class="text-button" @click="copyResult"><Check v-if="copied" :size="13" /><Copy v-else :size="13" /> {{ copied ? '已复制' : '复制' }}</button></div><div class="translation-output" :class="{ placeholder: !translation }">{{ translation || (loading ? '正在翻译…' : '译文会显示在这里') }}</div><span class="pane-foot">{{ loading ? '正在等待服务响应' : '可在设置中连接 OpenAI 或 DeepSeek' }}</span></div>
    </div>
    <div class="translate-actions"><button class="primary-button" :disabled="!canTranslate" @click="translate"><Sparkles :size="15" /> {{ loading ? '正在翻译…' : 'AI 翻译' }}</button><button class="secondary-button" :disabled="!sourceText.trim()" @click="openGoogle"><ExternalLink :size="14" /> Google Translate</button><button class="text-button configure-link" @click="emit('settings')">配置 AI 接口</button></div>
    <p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
  </section>
</template>
