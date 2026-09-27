<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, Copy, ExternalLink, Languages, Sparkles } from '@lucide/vue'
import type { TranslationPrefillRequest } from '@/shared/domain'
import { TRANSLATION_LANGUAGES, type TranslationLanguageCode, type TranslationSourceLanguage } from '@/shared/translation-contracts'
import type { TranslationProviderInfo } from '@/shared/translation-contracts'
import { TranslationRequestGate } from '@/shared/translation-request-gate'

const emit = defineEmits<{ settings: [] }>()
const props = defineProps<{ prefill: TranslationPrefillRequest | null }>()
const sourceText = ref('')
const translation = ref('')
const sourceLanguage = ref<TranslationSourceLanguage>('auto')
const targetLanguage = ref<TranslationLanguageCode>('zh-CN')
const loading = ref(false)
const errorMessage = ref('')
const copied = ref(false)
const providerInfo = ref<TranslationProviderInfo>()
const canTranslate = computed(() => Boolean(sourceText.value.trim()) && !loading.value)
const requestGate = new TranslationRequestGate()
let settingsReady = false
let settingsSaveTimer: number | undefined
let settingsSaveGeneration = 0
const languages = TRANSLATION_LANGUAGES.map(({ code, label }) => ({ value: code, label }))

function cancelActiveRequest(): void {
  const requestId = requestGate.invalidate()
  if (requestId) void window.desktop.cancelTranslation(requestId)
}

function invalidateResult(): void {
  cancelActiveRequest()
  translation.value = ''
  errorMessage.value = ''
  copied.value = false
  loading.value = false
}

watch([sourceText, sourceLanguage, targetLanguage], () => invalidateResult(), { flush: 'sync' })

watch([sourceLanguage, targetLanguage], () => {
  if (!settingsReady) return
  const generation = ++settingsSaveGeneration
  if (settingsSaveTimer !== undefined) window.clearTimeout(settingsSaveTimer)
  settingsSaveTimer = window.setTimeout(async () => {
    const settings = await window.desktop.getSettings().catch(() => null)
    if (!settings || generation !== settingsSaveGeneration) return
    const result = await window.desktop.updateSettings({
      translation: { ...settings.translation, sourceLanguage: sourceLanguage.value, targetLanguage: targetLanguage.value },
    })
    if (generation !== settingsSaveGeneration) return
    if (!result.ok) errorMessage.value = `语言设置未能保存：${result.error.message}`
  }, 180)
})

watch(() => props.prefill?.id, () => {
  const prefill = props.prefill
  if (!prefill) return
  invalidateResult()
  sourceText.value = prefill.text
}, { immediate: true })

onMounted(async () => {
  try {
    const [settings, info] = await Promise.all([window.desktop.getSettings(), window.desktop.getTranslationProviderInfo()])
    sourceLanguage.value = settings.translation.sourceLanguage
    targetLanguage.value = settings.translation.targetLanguage
    if (info.ok) providerInfo.value = info.data
  } catch {
    errorMessage.value = '无法读取翻译设置。'
  } finally { settingsReady = true }
})

onBeforeUnmount(() => {
  settingsReady = false
  if (settingsSaveTimer !== undefined) window.clearTimeout(settingsSaveTimer)
  cancelActiveRequest()
})

async function refreshProviderInfo(): Promise<void> {
  const result = await window.desktop.getTranslationProviderInfo()
  if (result.ok) providerInfo.value = result.data
}

async function translate(): Promise<void> {
  if (!sourceText.value.trim() || loading.value) return
  invalidateResult()
  const requestId = crypto.randomUUID()
  const token = requestGate.begin(requestId)
  const request = {
    requestId,
    text: sourceText.value,
    sourceLanguage: sourceLanguage.value,
    targetLanguage: targetLanguage.value,
  }
  loading.value = true
  try {
    const result = await window.desktop.translate(request)
    if (!requestGate.isCurrent(token)) return
    if (result.ok) {
      translation.value = result.data.translation
      providerInfo.value = result.data.provider
    } else errorMessage.value = result.error.message
  } catch {
    if (requestGate.isCurrent(token)) errorMessage.value = '翻译请求未能完成，请重试。'
  } finally {
    if (requestGate.finish(token)) {
      loading.value = false
    }
  }
}

function cancelTranslation(): void {
  invalidateResult()
}

function clearText(): void {
  invalidateResult()
  sourceText.value = ''
}

function swapLanguages(): void {
  if (sourceLanguage.value === 'auto') return
  const previousSource = sourceLanguage.value
  sourceLanguage.value = targetLanguage.value
  targetLanguage.value = previousSource
}

async function openGoogle(): Promise<void> {
  errorMessage.value = ''
  try {
    const result = await window.desktop.openGoogleTranslate({ text: sourceText.value, targetLanguage: targetLanguage.value })
    if (!result.ok) errorMessage.value = result.error.message
  } catch { errorMessage.value = '无法打开 Google Translate，请重试。' }
}

async function copyResult(): Promise<void> {
  const generation = requestGate.generation
  try {
    await navigator.clipboard.writeText(translation.value)
    if (!requestGate.isGenerationCurrent(generation)) return
    copied.value = true
    window.setTimeout(() => { if (requestGate.isGenerationCurrent(generation)) copied.value = false }, 1500)
  } catch {
    if (requestGate.isGenerationCurrent(generation)) errorMessage.value = '无法访问剪贴板，请手动复制译文。'
  }
}
</script>

<template>
  <section class="content-page translate-page" @keydown.ctrl.enter.prevent="translate">
    <div class="page-heading"><div><p class="eyebrow">快速理解一段文字</p><h1>翻译</h1><p class="page-description">仅在点击翻译后才会把原文发送给所选服务。</p></div></div>
    <div class="translation-toolbar">
      <select v-model="sourceLanguage" aria-label="来源语言"><option value="auto">自动识别</option><option v-for="language in languages" :key="language.value" :value="language.value">{{ language.label }}</option></select>
      <button class="secondary-button swap-language" :disabled="sourceLanguage === 'auto'" aria-label="交换来源和目标语言" title="交换语言" @click="swapLanguages">⇄</button>
      <select v-model="targetLanguage" aria-label="目标语言"><option v-for="language in languages" :key="language.value" :value="language.value">{{ language.label }}</option></select>
    </div>
    <div class="translation-columns">
      <label class="translation-pane"><span class="pane-heading">原文 <small>{{ sourceText.length }} / 20,000</small><button v-if="sourceText" class="text-button" type="button" @click.prevent="clearText">清除</button></span><textarea v-model="sourceText" maxlength="20000" placeholder="输入或粘贴要翻译的文字…"></textarea><span class="pane-foot">文本不会自动发送；按 Ctrl+Enter 可开始翻译。</span></label>
      <div class="translation-pane output-pane"><div class="pane-heading">译文 <button v-if="translation" class="text-button" @click="copyResult"><Check v-if="copied" :size="13" /><Copy v-else :size="13" /> {{ copied ? '已复制' : '复制' }}</button></div><div class="translation-output" :class="{ placeholder: !translation }">{{ translation || (loading ? '正在翻译…' : '译文会显示在这里') }}</div><span class="pane-foot">{{ providerInfo ? `${providerInfo.providerName}${providerInfo.model ? ` · ${providerInfo.model}` : ''}` : '尚未读取当前翻译服务' }}</span></div>
    </div>
    <div class="translate-actions"><button class="primary-button" :disabled="!canTranslate" @click="translate"><Sparkles :size="15" /> {{ loading ? '正在翻译…' : '翻译' }}</button><button v-if="loading" class="secondary-button" @click="cancelTranslation">取消</button><button class="secondary-button" :disabled="!sourceText.trim()" @click="openGoogle"><ExternalLink :size="14" /> 在 Google Translate 中打开</button><button v-if="!providerInfo?.configured" class="text-button configure-link" @click="emit('settings')">配置翻译服务</button></div>
    <p v-if="providerInfo && !providerInfo.configured" class="settings-note">当前服务尚未配置。可以先在此编辑文字，点击翻译时 WebTools 会显示明确的配置提示；也可以打开 Google Translate 网页。</p>
    <p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
  </section>
</template>
