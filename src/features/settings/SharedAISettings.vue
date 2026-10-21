<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Sparkles } from '@lucide/vue'
import { cloneSharedAISettings, isCredentialLikeAIValue, QWEN_REGIONS, safeAIModel, type AIProviderConfig, type AIProviderId, type QwenRegion } from '@/shared/ai-config'
import type { AppSettings } from '@/shared/domain'
import type { AIProviderDescriptor, AIProviderStatus } from '@/shared/ipc'

const emit = defineEmits<{ saved: [settings: AppSettings] }>()
const providers = ref<AIProviderDescriptor[]>([])
const statuses = ref<Partial<Record<AIProviderId, AIProviderStatus>>>({})
const statusErrors = ref<Partial<Record<AIProviderId, boolean>>>({})
const selectedProvider = ref<AIProviderId>('openai')
const defaultProvider = ref<AIProviderId>('openai')
const config = ref<AIProviderConfig>({ model: '' })
const savedConfig = ref<AIProviderConfig>({ model: '' })
const credentialDraft = ref('')
const removeConfirmation = ref(false)
const loading = ref(true)
const ready = ref(false)
const busy = ref(false)
const message = ref('')
const error = ref('')
const connectionResult = ref('')
const selectedDescriptor = computed(() => providers.value.find(provider => provider.id === selectedProvider.value))
const selectedStatus = computed(() => statuses.value[selectedProvider.value])
const configDirty = computed(() => JSON.stringify(config.value) !== JSON.stringify(savedConfig.value))
const hasPendingChanges = computed(() => configDirty.value || Boolean(credentialDraft.value.trim()))
const defaultDescriptor = computed(() => providers.value.find(provider => provider.id === defaultProvider.value))
const defaultStatus = computed(() => statuses.value[defaultProvider.value])
const regionLabels: Record<QwenRegion, string> = {
  'cn-beijing': '中国（北京）', 'ap-southeast-1': '新加坡', 'eu-central-1': '德国（法兰克福）',
  'ap-northeast-1': '日本（东京）', 'cn-hongkong': '中国香港', 'us-east-1': '美国（弗吉尼亚）',
}
let mounted = false
let generation = 0
let statusGeneration = 0

function applyConfig(settings: AppSettings): void {
  defaultProvider.value = settings.sharedAI.defaultProviderId
  const providerConfig = settings.sharedAI.providers[selectedProvider.value] ?? { model: '' }
  config.value = { ...providerConfig, model: safeAIModel(providerConfig.model) }
  savedConfig.value = { ...config.value }
}

async function refreshStatuses(): Promise<void> {
  const current = generation
  const request = ++statusGeneration
  const results = await Promise.all(providers.value.map(async provider => {
    try { return { id: provider.id, result: await window.desktop.getAIProviderStatus(provider.id) } }
    catch { return { id: provider.id, result: null } }
  }))
  if (!mounted || current !== generation || request !== statusGeneration) return
  const next: Partial<Record<AIProviderId, AIProviderStatus>> = {}
  const errors: Partial<Record<AIProviderId, boolean>> = {}
  for (const { id, result } of results) {
    if (result?.ok) next[id] = result.data
    else errors[id] = true
  }
  statuses.value = next
  statusErrors.value = errors
}

async function load(): Promise<void> {
  if (busy.value) return
  const current = ++generation
  loading.value = true
  ready.value = false
  error.value = ''
  try {
    const [settings, descriptors] = await Promise.all([window.desktop.getSettings(), window.desktop.getAIProviderDescriptors()])
    if (!mounted || current !== generation) return
    if (!descriptors.ok) { error.value = '无法读取 AI 提供方，请重试。'; return }
    providers.value = descriptors.data
    selectedProvider.value = settings.sharedAI.defaultProviderId
    applyConfig(settings)
    await refreshStatuses()
    if (mounted && current === generation) ready.value = true
  } catch { if (mounted && current === generation) error.value = '无法读取平台 AI 配置，请重试。' }
  finally { if (mounted && current === generation) loading.value = false }
}

async function selectProvider(id: AIProviderId): Promise<void> {
  if (busy.value || id === selectedProvider.value) return
  // Editing a provider does not change the Host's global default.
  busy.value = true
  error.value = ''
  message.value = ''
  credentialDraft.value = ''
  removeConfirmation.value = false
  connectionResult.value = ''
  try {
    const settings = await window.desktop.getSettings()
    if (!mounted) return
    selectedProvider.value = id
    applyConfig(settings)
  } catch { if (mounted) error.value = '无法读取提供方配置，当前选择保持不变。' }
  finally { if (mounted) busy.value = false }
}

async function saveConfiguration(testAfterSave = false): Promise<void> {
  if (!ready.value || busy.value) return
  const id = selectedProvider.value
  if (isCredentialLikeAIValue(config.value.model)) {
    config.value.model = ''
    error.value = '模型 ID 只填写公开模型名称。检测到密钥格式，已清除；请填写下方的密码型 API Key 输入框。'
    return
  }
  const draft: AIProviderConfig = { model: config.value.model.trim() }
  if (id === 'custom') draft.baseUrl = config.value.baseUrl?.trim() ?? ''
  if (id === 'qwen') {
    if (config.value.region) draft.region = config.value.region
    draft.workspaceId = config.value.workspaceId?.trim() ?? ''
  }
  busy.value = true
  error.value = ''; message.value = ''; connectionResult.value = ''
  try {
    const hasNewCredential = Boolean(credentialDraft.value.trim())
    const current = await window.desktop.getSettings()
    if (!mounted) return
    const sharedAI = cloneSharedAISettings(current.sharedAI)
    sharedAI.providers[id] = draft
    const result = await window.desktop.updateSettings({ sharedAI })
    if (!mounted) return
    if (!result.ok) { error.value = '提供方配置未保存，请检查模型、服务地址或地区与工作空间。'; return }
    applyConfig(result.data)
    emit('saved', result.data)
    if (credentialDraft.value.trim()) {
      const credentialResult = await window.desktop.saveAIProviderKey(id, credentialDraft.value.trim())
      if (!mounted) return
      if (!credentialResult.ok) {
        error.value = '模型配置已保存，但 API Key 未保存。输入仍保留为遮蔽状态，请重试保存。'
        await refreshStatuses()
        return
      }
      credentialDraft.value = ''
    }
    message.value = hasNewCredential
      ? '配置已保存；API Key 已交给 Host 安全存储，输入框已清空。平台默认提供方保持不变。'
      : '模型配置已保存；已保存的 API Key 保持不变。平台默认提供方保持不变。'
    await refreshStatuses()
    if (testAfterSave) {
      const tested = await window.desktop.testAIConnection(id)
      if (!mounted) return
      if (tested.ok) connectionResult.value = `连接测试成功 · ${tested.data.providerName} · ${tested.data.model}`
      else error.value = tested.error.message
    }
  } catch { if (mounted) error.value = '无法保存 AI 配置，请重试。' }
  finally { if (mounted) busy.value = false }
}

function rejectCredentialInModel(event: Event): void {
  const input = event.currentTarget as HTMLInputElement
  if (!isCredentialLikeAIValue(input.value)) {
    if (error.value.startsWith('模型 ID 只填写公开模型名称。')) error.value = ''
    return
  }
  input.value = ''
  config.value.model = ''
  error.value = '模型 ID 只填写公开模型名称。检测到密钥格式，已清除；请填写下方的密码型 API Key 输入框。'
}

async function setDefaultProvider(id: AIProviderId): Promise<void> {
  if (!ready.value || busy.value || id === defaultProvider.value) return
  busy.value = true
  error.value = ''; message.value = ''
  try {
    const current = await window.desktop.getSettings()
    if (!mounted) return
    const sharedAI = cloneSharedAISettings(current.sharedAI)
    sharedAI.defaultProviderId = id
    const result = await window.desktop.updateSettings({ sharedAI })
    if (!mounted) return
    if (!result.ok) { error.value = '默认提供方未保存，请重试。'; return }
    defaultProvider.value = result.data.sharedAI.defaultProviderId
    emit('saved', result.data)
    message.value = '默认提供方已保存。Shared AI 使用该提供方的已保存模型。'
    await refreshStatuses()
  } catch { if (mounted) error.value = '无法保存默认提供方，请重试。' }
  finally { if (mounted) busy.value = false }
}

async function removeCredential(): Promise<void> {
  if (!ready.value || busy.value || !removeConfirmation.value) return
  busy.value = true
  error.value = ''; message.value = ''; connectionResult.value = ''
  credentialDraft.value = ''
  try {
    const result = await window.desktop.clearAIProviderKey(selectedProvider.value)
    if (!mounted) return
    if (!result.ok) { error.value = '无法移除凭据，请重试。'; return }
    removeConfirmation.value = false
    message.value = '已移除当前提供方凭据；其他提供方保持不变。'
    await refreshStatuses()
  } catch { if (mounted) error.value = '无法移除凭据，请重试。' }
  finally { if (mounted) busy.value = false }
}

watch(config, () => { connectionResult.value = ''; removeConfirmation.value = false }, { deep: true })
onMounted(() => { mounted = true; void load() })
onBeforeUnmount(() => { mounted = false; ++generation; credentialDraft.value = '' })
defineExpose({ hasPendingChanges, busy })
</script>

<template>
  <div class="shared-ai-settings">
    <p v-if="loading" class="settings-note" role="status">正在读取平台 AI 配置…</p>
    <template v-if="ready">
      <div class="settings-group ai-settings">
        <div class="settings-group-heading"><span class="settings-group-icon"><Sparkles :size="17" /></span><div><strong>AI 配置</strong><p>在这里设置平台默认服务、模型和 API Key；普通插件不需要配置 AI。</p></div></div>
        <label class="field-label">平台默认提供方<select :value="defaultProvider" :disabled="busy" @change="setDefaultProvider(($event.target as HTMLSelectElement).value as AIProviderId)"><option v-for="provider in providers" :key="provider.id" :value="provider.id">{{ provider.name }}</option></select></label>
        <p class="settings-note">当前默认模型：{{ statusErrors[defaultProvider] ? '暂不可读' : defaultStatus?.model || defaultDescriptor?.defaultModel || '尚未设置' }}<span v-if="defaultStatus && !defaultStatus.configured"> · 配置尚不完整，AI 调用暂不可用</span><span v-else-if="statusErrors[defaultProvider]"> · 安全存储状态暂不可读</span></p>
        <p class="settings-note">默认提供方使用已保存模型；未填写时采用服务商内置默认值。自定义服务必须明确填写模型。</p>
        <h3 class="provider-section-title">编辑服务</h3>
        <p class="settings-note">选择要编辑的提供方，不会自动更改上方的平台默认选择。切换时未保存输入会直接丢弃。</p>
        <div class="ai-provider-list" aria-label="AI 提供方">
          <button v-for="provider in providers" :key="provider.id" type="button" :class="{ selected: selectedProvider === provider.id }" :aria-pressed="selectedProvider === provider.id" :disabled="busy" @click="selectProvider(provider.id)"><span>{{ provider.name }}<small v-if="defaultProvider === provider.id">默认</small></span><small>{{ statusErrors[provider.id] ? '状态不可读' : statuses[provider.id]?.configured ? '配置完整' : '待配置' }}</small></button>
        </div>
        <p class="settings-note">“配置完整”只表示模型、地址和密钥齐备，不代表已连接服务。</p>
        <label class="field-label">模型 ID<input v-model="config.model" maxlength="120" :disabled="busy" :placeholder="selectedDescriptor?.modelHint" @input="rejectCredentialInModel" /></label>
        <label v-if="selectedProvider === 'custom'" class="field-label">OpenAI 兼容服务地址<input v-model="config.baseUrl" maxlength="500" :disabled="busy" placeholder="https://example.com/v1" /></label>
        <template v-if="selectedProvider === 'qwen'">
          <label class="field-label">Qwen 服务地区<select v-model="config.region" :disabled="busy"><option :value="undefined" disabled>请选择地区</option><option v-for="region in QWEN_REGIONS" :key="region" :value="region">{{ regionLabels[region] }}</option></select></label>
          <label class="field-label">工作空间 ID<input v-model="config.workspaceId" maxlength="100" :disabled="busy" placeholder="DashScope 工作空间 ID" /></label>
        </template>
        <p class="settings-note">当前服务：{{ selectedDescriptor?.name }} · 已保存有效模型：{{ statusErrors[selectedProvider] ? '暂不可读' : selectedStatus?.model || '尚未设置' }}</p>
        <p v-if="selectedDescriptor" class="settings-note provider-documentation">官方文档：{{ selectedDescriptor.documentationUrl }}</p>
        <p class="settings-note">API Key 状态：{{ statusErrors[selectedProvider] ? '暂不可读' : selectedStatus?.hasApiKey ? '已安全保存；不会显示原值' : '尚未配置' }}。密钥只填写在此密码框，可直接粘贴；保存成功后输入自动清空。</p>
        <label class="field-label">API Key<input v-model="credentialDraft" type="password" maxlength="4096" autocomplete="new-password" autocapitalize="off" spellcheck="false" :disabled="busy" :placeholder="selectedStatus?.hasApiKey ? '已保存；输入新密钥可替换' : '粘贴 API Key'" /></label>
        <div class="ai-settings-actions"><button type="button" class="primary-button" :disabled="busy || (!configDirty && !credentialDraft.trim())" @click="saveConfiguration(false)">{{ busy ? '保存中…' : '保存配置' }}</button><button type="button" class="secondary-button" :disabled="busy || (!configDirty && !credentialDraft.trim() && !selectedStatus?.configured)" @click="saveConfiguration(true)">{{ busy ? '处理中…' : '保存并测试连接' }}</button><button v-if="selectedStatus?.hasApiKey" type="button" class="secondary-button" :disabled="busy" @click="removeConfirmation = true">移除 API Key</button></div>
        <div v-if="removeConfirmation" class="credential-confirmation"><p class="settings-note">确认移除 {{ selectedDescriptor?.name }} 的已保存 API Key？此提供方将无法连接，其他服务不受影响。</p><div class="ai-settings-actions"><button type="button" class="secondary-button" :disabled="busy" @click="removeConfirmation = false">返回</button><button type="button" class="secondary-button" :disabled="busy" @click="removeCredential">确认移除</button></div></div>
        <p class="secret-note">API Key 通过 Host 的安全存储保存，不写入普通设置、插件配置或 localStorage；页面无法读取已保存密钥。</p>
        <p v-if="connectionResult" class="settings-result" role="status">{{ connectionResult }}</p>
      </div>
    </template>
    <p v-if="message" class="settings-note" role="status">{{ message }}</p>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <button v-if="!ready && !loading" type="button" class="secondary-button" @click="load">重新读取 AI 配置</button>
  </div>
</template>

<style scoped>
.ai-provider-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(var(--manager-unit) * 12)), 1fr)); gap: calc(var(--manager-unit) * .4); }
.ai-provider-list button { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--manager-unit) * .5); padding: calc(var(--manager-unit) * .65); border: 1px solid var(--line); border-radius: calc(var(--manager-unit) * .5); color: var(--text); background: var(--surface-raised); font: inherit; font-size: var(--manager-font-body); text-align: left; cursor: pointer; }
.ai-provider-list button:hover:not(:disabled) { background: var(--hover); }
.ai-provider-list button.selected { background: var(--accent-soft); border-color: var(--accent); }
.ai-provider-list button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ai-provider-list button span { display: flex; flex-wrap: wrap; align-items: center; gap: calc(var(--manager-unit) * .4); }
.ai-provider-list small { color: var(--muted); font-size: var(--manager-font-small); }
.ai-settings-actions { flex-wrap: wrap; }
.provider-documentation { overflow-wrap: anywhere; }
.credential-confirmation { padding-top: calc(var(--manager-unit) * .5); border-top: 1px solid var(--line); }
.provider-section-title { margin: calc(var(--manager-unit) * 1.2) 0 calc(var(--manager-unit) * .35); color: var(--text); font-size: var(--manager-font-body); }
</style>
