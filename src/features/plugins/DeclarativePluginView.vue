<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowLeft, Check, CircleAlert, LoaderCircle, Send } from '@lucide/vue'
import type { IpcResult } from '../../shared/ipc.ts'
import type { PluginAIReviewDTO, PluginActionResult, PluginInvokeRequest, PluginPage, PluginPageDTO, PluginSetting, PluginSettingValue } from '../../shared/plugin-contracts.ts'
import PluginAIReviewDialog from './PluginAIReviewDialog.vue'
import PluginSettingEditor from './PluginSettingEditor.vue'
import { pluginOperationError, pluginTextActionLimit } from './plugin-view-model.ts'

type PluginActionDescriptor = PluginPageDTO['actions'][number]

const props = defineProps<{ page: PluginPageDTO; pluginName: string }>()
const emit = defineEmits<{ leave: [] }>()

const activePageId = ref(props.page.entry.pageId)
const visiblePage = computed(() => props.page.pages.find(page => page.id === activePageId.value) ?? props.page.pages[0] ?? null)
const values = ref<Record<string, PluginSettingValue>>({})
const fieldErrors = ref<Record<string, string>>({})
const busyAction = ref<string | null>(null)
const actionInput = ref<{ action: PluginActionDescriptor; value: string } | null>(null)
const actionInputLimit = computed(() => actionInput.value ? pluginTextActionLimit(actionInput.value.action.type) : 0)
const actionMessage = ref<{ kind: 'status' | 'error'; text: string } | null>(null)
const aiReview = ref<PluginAIReviewDTO | null>(null)
const pageGeneration = ref(0)
const actionMap = computed(() => new Map(props.page.actions.map(action => [action.id, action])))
const renderedSettingKeys = computed(() => new Set((visiblePage.value?.blocks ?? []).flatMap(block => 'settingKey' in block ? [block.settingKey] : [])))
const additionalSettings = computed(() => props.page.settings.filter(setting => !renderedSettingKeys.value.has(setting.key)))

function loadValues(page: PluginPageDTO): void {
  const next: Record<string, PluginSettingValue> = {}
  for (const setting of page.settings) next[setting.key] = page.config?.[setting.key] ?? setting.default
  values.value = next
  fieldErrors.value = {}
}
loadValues(props.page)

watch(() => [props.page.pluginId, props.page.version, props.page.hash] as const, () => {
  pageGeneration.value++
  activePageId.value = props.page.entry.pageId
  loadValues(props.page)
  busyAction.value = null
  actionInput.value = null
  actionMessage.value = null
  cancelReview()
})

function settingFor(key: string): PluginSetting | undefined { return props.page.settings.find(setting => setting.key === key) }
function displayedValue(key: string): PluginSettingValue {
  const setting = settingFor(key)
  return values.value[key] ?? setting?.default ?? ''
}
function actionForSetting(key: string): PluginActionDescriptor | undefined { return props.page.actions.find(action => action.type === 'plugin.config.write' && action.key === key) }

function validateSetting(setting: PluginSetting, value: unknown): string {
  if (setting.type === 'text') return typeof value === 'string' && value.length >= setting.minLength && value.length <= setting.maxLength ? '' : `请输入 ${setting.minLength}–${setting.maxLength} 个字符。`
  if (setting.type === 'enum') return typeof value === 'string' && setting.options.includes(value) ? '' : '请选择有效选项。'
  if (setting.type === 'boolean') return typeof value === 'boolean' ? '' : '请选择开或关。'
  return typeof value === 'number' && Number.isFinite(value) && value >= setting.min && value <= setting.max ? '' : `请输入 ${setting.min} 到 ${setting.max} 之间的数值。`
}

function updateValue(setting: PluginSetting, value: PluginSettingValue): void {
  values.value = { ...values.value, [setting.key]: value }
  const error = validateSetting(setting, value)
  fieldErrors.value = { ...fieldErrors.value, [setting.key]: error }
}

function requestFor(action: PluginActionDescriptor, input: PluginInvokeRequest['input']): PluginInvokeRequest {
  return { pluginId: props.page.pluginId, version: props.page.version, hash: props.page.hash, actionId: action.id, input }
}

function requiresTextInput(action: PluginActionDescriptor): boolean { return action.type === 'sharedAI.complete' || action.type === 'clipboard.write' || action.type === 'plugin.storage.write' }

function beginAction(actionId: string): void {
  const action = actionMap.value.get(actionId)
  if (!action || busyAction.value || aiReview.value) return
  actionMessage.value = null
  if (requiresTextInput(action)) { actionInput.value = { action, value: '' }; return }
  const input = action.type === 'plugin.config.write' ? { value: action.key ? displayedValue(action.key) : null } : null
  void executeAction(action, input as PluginInvokeRequest['input'])
}

async function saveSetting(setting: PluginSetting): Promise<void> {
  const action = actionForSetting(setting.key)
  if (!action) { fieldErrors.value = { ...fieldErrors.value, [setting.key]: '没有可用的设置保存操作。' }; return }
  const value = displayedValue(setting.key)
  const error = validateSetting(setting, value)
  fieldErrors.value = { ...fieldErrors.value, [setting.key]: error }
  if (error) return
  await executeAction(action, { value })
}

async function submitTextAction(): Promise<void> {
  if (!actionInput.value) return
  const { action, value } = actionInput.value
  let input: PluginInvokeRequest['input']
  if (action.type === 'sharedAI.complete') input = { messages: [{ role: 'user', content: value }] }
  else if (action.type === 'clipboard.write') input = { text: value }
  else if (action.type === 'plugin.storage.write') input = { value }
  else return
  actionInput.value = null
  await executeAction(action, input)
}

async function executeAction(action: PluginActionDescriptor, input: PluginInvokeRequest['input']): Promise<void> {
  if (busyAction.value || !visiblePage.value) return
  const generation = pageGeneration.value
  const identity = `${props.page.pluginId}/${props.page.version}/${props.page.hash}/${visiblePage.value.id}`
  if (action.type === 'sharedAI.complete') {
    busyAction.value = action.id
    try {
      const prepared = await window.desktop.plugins.prepareAIReview(requestFor(action, input))
      if (!prepared.ok) { if (generation === pageGeneration.value) actionMessage.value = { kind: 'error', text: pluginOperationError(prepared.error) }; return }
      if (generation !== pageGeneration.value || identity !== `${props.page.pluginId}/${props.page.version}/${props.page.hash}/${visiblePage.value?.id}`) {
        await window.desktop.plugins.cancelAIReview(prepared.data.reviewId)
        return
      }
      aiReview.value = prepared.data
    } catch { if (generation === pageGeneration.value) actionMessage.value = { kind: 'error', text: '无法准备 AI 请求预览。' } }
    finally { busyAction.value = null }
    return
  }
  busyAction.value = action.id
  actionMessage.value = null
  try {
    const result = await window.desktop.plugins.invoke(requestFor(action, input))
    if (generation !== pageGeneration.value || identity !== `${props.page.pluginId}/${props.page.version}/${props.page.hash}/${visiblePage.value?.id}`) return
    if (!result.ok) { actionMessage.value = { kind: 'error', text: pluginOperationError(result.error) }; return }
    if (action.type === 'plugin.config.write') actionMessage.value = { kind: 'status', text: '设置已保存。' }
    else displayResult(result.data)
  } catch { if (generation === pageGeneration.value) actionMessage.value = { kind: 'error', text: '插件操作没有完成。' } }
  finally { if (busyAction.value === action.id) busyAction.value = null }
}

function displayResult(result: PluginActionResult): void {
  if (result.status === 'cancelled') { actionMessage.value = { kind: 'status', text: '操作已取消，没有继续执行。' }; return }
  const value = result.value
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '操作完成。'
  if (text.length > 20_000) text = `${text.slice(0, 20_000)}\n\n（结果过长，仅显示前 20,000 个字符。）`
  actionMessage.value = { kind: 'status', text: text || '操作完成。' }
}

function onAICompleted(result: IpcResult<PluginActionResult>): void {
  aiReview.value = null
  if (!result.ok) { actionMessage.value = { kind: 'error', text: result.error.message }; return }
  displayResult(result.data)
}

function cancelReview(): void {
  const review = aiReview.value
  aiReview.value = null
  if (review) void window.desktop.plugins.cancelAIReview(review.reviewId)
}

function goPage(page: PluginPage): void {
  if (page.id === activePageId.value) return
  cancelReview()
  pageGeneration.value++
  activePageId.value = page.id
  busyAction.value = null
  actionInput.value = null
  actionMessage.value = null
}

onBeforeUnmount(() => { pageGeneration.value++; cancelReview() })
</script>

<template>
  <section class="content-page declarative-plugin-page">
    <header class="plugin-page-heading">
      <div><p class="eyebrow">插件页面</p><h1>{{ pluginName }}</h1><p>{{ visiblePage?.title ?? page.entry.label }}</p></div>
      <button type="button" class="secondary-button" @click="emit('leave')"><ArrowLeft :size="14" />返回插件管理</button>
    </header>

    <nav v-if="page.pages.length > 1" class="plugin-page-tabs" aria-label="插件页面">
      <button v-for="pageOption in page.pages" :key="pageOption.id" type="button" :aria-pressed="activePageId === pageOption.id" :class="{ selected: activePageId === pageOption.id }" @click="goPage(pageOption)">{{ pageOption.title }}</button>
    </nav>

    <article v-if="visiblePage" class="declarative-plugin-content">
      <template v-for="(block, index) in visiblePage.blocks" :key="`${visiblePage.id}-${index}`">
        <h2 v-if="block.type === 'heading'" class="plugin-block-heading">{{ block.text }}</h2>
        <p v-else-if="block.type === 'paragraph'" class="plugin-block-paragraph">{{ block.text }}</p>
        <hr v-else-if="block.type === 'divider'" class="plugin-block-divider" />
        <PluginSettingEditor v-else-if="block.type === 'text-input' || block.type === 'select' || block.type === 'checkbox'" :setting="settingFor(block.settingKey)!" :value="displayedValue(block.settingKey)" :error="fieldErrors[block.settingKey]" :busy="busyAction === actionForSetting(block.settingKey)?.id" :can-save="Boolean(actionForSetting(block.settingKey))" :id-suffix="`${visiblePage.id}-${index}`" @update:value="updateValue(settingFor(block.settingKey)!, $event)" @save="saveSetting(settingFor(block.settingKey)!)" />
        <div v-else-if="block.type === 'button'" class="plugin-action-block">
          <button type="button" class="secondary-button" :disabled="Boolean(busyAction) || Boolean(aiReview) || Boolean(actionInput)" @click="beginAction(block.actionId)">
            <LoaderCircle v-if="busyAction === block.actionId" :size="14" class="plugin-action-spin" /><Send v-else :size="14" />{{ busyAction === block.actionId ? '正在执行…' : block.label }}
          </button>
        </div>
      </template>
    </article>

    <section v-if="additionalSettings.length" class="plugin-settings-editor" aria-labelledby="plugin-settings-title">
      <div><h2 id="plugin-settings-title">插件设置</h2><p>保存前会按插件声明检查类型和值的范围。</p></div>
      <PluginSettingEditor v-for="setting in additionalSettings" :key="setting.key" :setting="setting" :value="displayedValue(setting.key)" :error="fieldErrors[setting.key]" :busy="busyAction === actionForSetting(setting.key)?.id" :can-save="Boolean(actionForSetting(setting.key))" id-suffix="extra" @update:value="updateValue(setting, $event)" @save="saveSetting(setting)" />
    </section>

    <div v-if="actionInput" class="plugin-action-input">
      <label for="plugin-action-input">{{ actionInput.action.type === 'sharedAI.complete' ? '要发送给共享 AI 的完整内容' : actionInput.action.type === 'clipboard.write' ? '要复制到剪贴板的内容' : '要保存到插件私有数据的内容' }}</label>
      <textarea id="plugin-action-input" v-model="actionInput.value" rows="5" :maxlength="actionInputLimit" :aria-describedby="actionInput.action.type === 'clipboard.write' ? 'plugin-action-input-limit' : undefined" />
      <div class="plugin-action-input-footer"><small>{{ actionInput.value.length }} / {{ actionInputLimit.toLocaleString() }}</small><button type="button" class="secondary-button" @click="actionInput = null">取消</button><button type="button" class="primary-button" :disabled="Boolean(busyAction) || actionInput.value.length > actionInputLimit" @click="submitTextAction">{{ actionInput.action.type === 'sharedAI.complete' ? '检查 AI 请求' : '执行操作' }}</button></div>
      <small v-if="actionInput.action.type === 'clipboard.write'" id="plugin-action-input-limit" class="plugin-action-input-note">宿主确认对话框最多显示 24,000 个字符，因此剪贴板内容限制为 24,000 个字符。</small>
    </div>

    <p v-if="actionMessage" class="plugin-action-result" :class="{ 'is-error': actionMessage.kind === 'error' }" :role="actionMessage.kind === 'error' ? 'alert' : 'status'" aria-live="polite"><CircleAlert v-if="actionMessage.kind === 'error'" :size="15" /><Check v-else :size="15" /><span>{{ actionMessage.text }}</span></p>
    <PluginAIReviewDialog :review="aiReview" @completed="onAICompleted" @cancelled="aiReview = null" />
  </section>
</template>

<style scoped>
.declarative-plugin-page { width: min(920px, 100%); max-width: 920px; align-self: stretch; }
.plugin-page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 18px; }
.plugin-page-heading h1 { margin: 0; overflow-wrap: anywhere; font-size: 22px; }
.plugin-page-heading p:last-child { margin: 7px 0 0; color: var(--muted); font-size: 10px; }
.plugin-page-heading .secondary-button { flex: 0 0 auto; }
.plugin-page-tabs { display: flex; flex-wrap: wrap; gap: 5px; padding-bottom: 11px; margin-bottom: 15px; border-bottom: 1px solid var(--line); }
.plugin-page-tabs button { padding: 7px 10px; border: 0; border-radius: 7px; color: var(--muted); background: transparent; font: inherit; font-size: 10px; cursor: pointer; }
.plugin-page-tabs button:hover, .plugin-page-tabs button.selected { color: var(--text); background: var(--hover); }
.declarative-plugin-content { display: grid; gap: 13px; }
.plugin-block-heading { margin: 7px 0 0; font-size: 17px; font-weight: 620; }
.plugin-block-paragraph { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.plugin-block-divider { width: 100%; border: 0; border-top: 1px solid var(--line); }
.plugin-settings-editor { display: grid; gap: 13px; padding-top: 18px; border-top: 1px solid var(--line); }
.plugin-settings-editor h2 { margin: 0; font-size: 13px; }
.plugin-settings-editor p { margin: 4px 0 0; color: var(--muted); font-size: 9px; }
.plugin-action-block { display: grid; justify-items: start; gap: 9px; }
.plugin-action-input { display: grid; width: min(620px, 100%); gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); }
.plugin-action-input label { font-size: 10px; font-weight: 550; }
.plugin-action-input textarea { min-height: 100px; resize: vertical; line-height: 1.5; }
.plugin-action-input-footer { display: flex; align-items: center; justify-content: flex-end; gap: 7px; }
.plugin-action-input-footer small { margin-right: auto; color: var(--muted); font-size: 9px; }
.plugin-action-input-note { color: var(--muted); font-size: 9px; line-height: 1.5; }
.plugin-action-result { display: flex; align-items: flex-start; gap: 8px; padding: 11px; margin: 16px 0 0; border-radius: 8px; color: #82cb9c; background: var(--surface); font-size: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.plugin-action-result span { max-height: 35vh; overflow: auto; }
.plugin-action-result.is-error { color: #e69b93; }
.plugin-action-spin { animation: plugin-spin 1.2s linear infinite; }
@keyframes plugin-spin { to { transform: rotate(360deg); } }
@media (max-width: 680px) { .plugin-page-heading { flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { .plugin-action-spin { animation: none; } }
</style>
