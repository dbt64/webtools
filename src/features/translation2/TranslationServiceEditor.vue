<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from '@lucide/vue'
import { isAIProviderId, isCredentialLikeAIValue, QWEN_REGIONS, type AIProviderConfig, type AIProviderId, type QwenRegion } from '@/shared/ai-config.ts'
const props = defineProps<{ selectedService?: string; providers: { id: AIProviderId; name: string }[] }>()
const emit = defineEmits<{ close: []; saved: [providerId: AIProviderId | null] }>()
const selected = ref('')
const config = ref<AIProviderConfig>({ model: '' })
const defaultModel = ref('')
const secret = ref(''), hasKey = ref(false)
const name = ref('DeepL 1'), apiPlan = ref<'free' | 'pro'>('free')
const busy = ref(false), message = ref(''), error = ref('')
let alive = true, generation = 0
const aiId = computed(() => isAIProviderId(selected.value) ? selected.value : null)
const title = computed(() => selected.value === 'deepl' ? 'DeepL API' : props.providers.find(p => p.id === selected.value)?.name ?? '添加翻译服务')

async function choose(id: string) {
  if (busy.value) return
  const token = ++generation
  selected.value = id; secret.value = ''; message.value = ''; error.value = ''
  config.value = { model: '' }; hasKey.value = false
  if (!isAIProviderId(id)) return
  busy.value = true
  try {
    const result = await window.translation2.getAIConfiguration(id)
    if (!alive || token !== generation) return
    if (!result.ok) { error.value = result.error.message; return }
    config.value = { ...result.data.config }; defaultModel.value = result.data.defaultModel; hasKey.value = result.data.hasApiKey
  } catch { if (alive) error.value = '无法读取服务配置，请重试。' }
  finally { if (alive && token === generation) busy.value = false }
}

async function save(test = false) {
  if (busy.value) return
  if (aiId.value && isCredentialLikeAIValue(config.value.model)) { error.value = '模型 ID 中不能填写密钥。请将 API Key 放入下方独立输入框。'; return }
  if (!secret.value.trim() && (selected.value === 'deepl' || !hasKey.value)) { error.value = '请在 API Key 输入框填写密钥。'; return }
  busy.value = true; message.value = ''; error.value = ''
  let secretPersisted = false
  try {
    if (selected.value === 'deepl') {
      if (test) {
        const tested = await window.translation2.testDeepL({ secret: secret.value, apiPlan: apiPlan.value })
        if (!tested.ok) { error.value = tested.error.message; return }
        message.value = 'DeepL 连接测试通过，正在保存服务…'
      }
      const saved = await window.translation2.saveDeepL({ name: name.value, secret: secret.value, apiPlan: apiPlan.value })
      if (!saved.ok) { error.value = saved.error.message; return }
      message.value = test ? 'DeepL 连接测试通过，服务已保存并选中；密钥输入已清空。' : 'DeepL 服务已保存并选中；密钥输入已清空。'
      secretPersisted = true; secret.value = ''; emit('saved', null)
      if (!test) emit('close')
    } else if (aiId.value) {
      const providerId = aiId.value
      const draft: AIProviderConfig = { model: config.value.model.trim() || defaultModel.value }
      if (providerId === 'custom') draft.baseUrl = config.value.baseUrl?.trim() ?? ''
      if (providerId === 'qwen') { draft.region = config.value.region; draft.workspaceId = config.value.workspaceId?.trim() ?? '' }
      const saved = await window.translation2.saveAIConfiguration({ providerId, config: draft, ...(secret.value ? { secret: secret.value } : {}) })
      if (!saved.ok) { error.value = saved.error.message; return }
      secretPersisted = Boolean(secret.value); secret.value = ''
      const status = await window.translation2.getAIConfiguration(providerId)
      hasKey.value = status.ok && status.data.hasApiKey
      emit('saved', providerId)
      if (test) {
        const tested = await window.translation2.testAIConnection(providerId)
        if (!tested.ok) { error.value = tested.error.message; return }
        message.value = '连接测试通过，已选中此服务用于翻译。'
      } else message.value = '配置已保存并用于翻译；尚未测试连接。'
    }
  } catch { if (alive) error.value = '操作未完成，请检查配置和网络后重试。' }
  finally { if (secretPersisted) secret.value = ''; if (alive) busy.value = false }
}
function rejectCredentialInModel(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  if (!isCredentialLikeAIValue(input.value)) {
    if (error.value.startsWith('模型 ID 只填写公开模型名称。')) error.value = ''
    return
  }
  input.value = ''
  config.value.model = ''
  error.value = '模型 ID 只填写公开模型名称。检测到密钥格式，已清除；请改填到下方独立的 API Key 输入框。'
}
function close() { if (!busy.value) { secret.value = ''; emit('close') } }
onMounted(() => { if (selected.value) void choose(selected.value) })
onBeforeUnmount(() => { alive = false; ++generation; secret.value = '' })
</script>

<template>
  <div class="service-editor-backdrop" @click.self="close">
    <section class="service-editor" role="dialog" aria-modal="true" :aria-label="title">
      <header><h2>{{ title }}</h2><button type="button" :disabled="busy" aria-label="关闭服务配置" @click="close"><X :size="20" /></button></header>
      <template v-if="!selected">
        <div class="catalog-sections" aria-label="翻译服务列表">
          <section class="catalog-section"><h3>AI 服务</h3><div class="catalog">
            <button v-for="p in providers" :key="p.id" type="button" class="catalog-option" :class="{ selected: selectedService === `ai:${p.id}` }" :aria-pressed="selectedService === `ai:${p.id}`" @click="choose(p.id)"><span class="catalog-option-name">{{ p.name }}</span><span class="catalog-option-action">{{ selectedService === `ai:${p.id}` ? '当前选择 · 配置' : '添加 / 配置' }}</span></button>
          </div></section>
          <section class="catalog-section"><h3>机器翻译 API</h3><div class="catalog">
            <button type="button" class="catalog-option" :class="{ selected: selectedService === 'deepl' }" :aria-pressed="selectedService === 'deepl'" @click="choose('deepl')"><span class="catalog-option-name">DeepL API</span><span class="catalog-option-action">{{ selectedService === 'deepl' ? '当前服务 · 添加实例' : '添加服务' }}</span></button>
          </div></section>
        </div>
        <p class="catalog-note">选择服务后填写模型与 API Key。密钥使用密码框并支持粘贴；保存后会清空输入，已保存密钥不会显示。AI 模型和凭据与“设置 → AI”共用，翻译所用服务单独选择。网站翻译不需要这里的密钥。</p>
      </template>
      <template v-else>
        <button class="back" type="button" :disabled="busy" @click="choose('')">← 选择其他服务</button>
        <template v-if="selected === 'deepl'">
          <label>服务名称<input v-model="name" :disabled="busy" maxlength="80" placeholder="例如 DeepL 1"></label>
          <label>API 类型<select v-model="apiPlan" :disabled="busy"><option value="free">DeepL API Free</option><option value="pro">DeepL API Pro</option></select></label>
          <p>{{ apiPlan === 'free' ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate' }}</p>
        </template>
        <template v-else>
          <label>模型 ID<input v-model="config.model" :disabled="busy" maxlength="120" :placeholder="defaultModel || '填写模型 ID，例如服务商提供的模型名称'" @input="rejectCredentialInModel"></label>
          <label v-if="selected === 'custom'">OpenAI 兼容 API 地址<input v-model="config.baseUrl" :disabled="busy" placeholder="https://example.com/v1"></label>
          <template v-if="selected === 'qwen'"><label>地区<select v-model="config.region" :disabled="busy"><option v-for="region in QWEN_REGIONS" :key="region" :value="region as QwenRegion">{{ region }}</option></select></label><label>工作空间 ID<input v-model="config.workspaceId" :disabled="busy" maxlength="100"></label></template>
        </template>
        <label>API Key<input v-model="secret" :disabled="busy" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" maxlength="4096" :placeholder="hasKey ? '已安全保存；输入新密钥可替换' : '粘贴 API Key'"></label>
        <p>密钥只发送给 Host 安全存储，不会读回页面。保存成功后输入会清空；连接测试与保存操作放在同一表单。</p>
        <div class="editor-actions"><button type="button" :disabled="busy" @click="save(false)">保存并使用</button><button type="button" :disabled="busy" @click="save(true)">{{ busy ? '正在处理…' : '保存并测试连接' }}</button></div>
      </template>
      <p v-if="message" role="status">{{ message }}</p><p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
  </div>
</template>

<style scoped>
.service-editor-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 24px; background: rgb(0 0 0 / .38); }
.service-editor { width: min(1100px, 94vw); max-height: 92vh; overflow-y: auto; border: 1px solid var(--border); border-radius: 16px; padding: clamp(20px, 3vw, 34px); color: var(--text); background: var(--surface); box-shadow: 0 20px 64px rgb(0 0 0 / .2); }
header, .editor-actions { display: flex; align-items: center; gap: 10px; } header { justify-content: space-between; } h2 { margin: 0; font-size: 20px; } h3 { font-size: 14px; margin: 24px 0 10px; }
button, input, select { font: inherit; color: inherit; } button { padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
.catalog-sections { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; max-height: min(58vh, 540px); overflow-y: auto; overscroll-behavior: contain; margin-top: 24px; padding-inline-end: 8px; scrollbar-color: color-mix(in srgb, var(--muted) 45%, transparent) transparent; scrollbar-width: thin; }
.catalog-sections::-webkit-scrollbar { width: var(--manager-scrollbar-size, 6px); }
.catalog-sections::-webkit-scrollbar-track { background: transparent; }
.catalog-sections::-webkit-scrollbar-thumb { border-radius: 999px; background: color-mix(in srgb, var(--muted) 45%, transparent); }
.catalog-sections::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--muted) 65%, transparent); }
.catalog-section { min-width: 0; }
.catalog-section h3 { margin: 0 0 10px; font-size: 16px; }
.catalog { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.catalog-option { min-height: 60px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; text-align: left; border-radius: 12px; }
.catalog-option:hover { border-color: var(--accent); }
.catalog-option.selected { border-color: var(--accent); background: var(--accent-soft); }
.catalog-option:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.catalog-option-name { min-width: 0; font-weight: 600; }
.catalog-option-action { flex: 0 0 auto; color: var(--muted); font-size: var(--manager-font-small, 12px); text-align: right; white-space: nowrap; }
.catalog-note { margin: 20px 0 0; }
label { display: grid; gap: 8px; margin-top: 18px; font-size: 14px; } input, select { width: 100%; min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
p { overflow-wrap: anywhere; color: var(--muted); font-size: 13px; line-height: 1.6; } .back { margin-top: 16px; }.editor-actions { margin-top: 22px; flex-wrap: wrap; }.error { color: #d55353; }
@media (max-width: 760px) { .service-editor-backdrop { padding: 12px; }.service-editor { width: 100%; max-height: 96vh; }.catalog-option { gap: 8px; padding-inline: 12px; } }
@media (max-width: 560px) { .catalog { grid-template-columns: minmax(0, 1fr); } }
</style>
