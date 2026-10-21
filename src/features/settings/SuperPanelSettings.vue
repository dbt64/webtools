<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Mouse } from '@lucide/vue'
import { DEFAULT_SUPER_PANEL_SETTINGS, type SuperPanelSettings, type SuperPanelSettingsStatus } from '@/shared/super-panel-settings'

const props = defineProps<{ focusRequestId?: string }>()
const section = ref<HTMLElement | null>(null)
const state = ref<SuperPanelSettingsStatus | null>(null)
const draft = ref<SuperPanelSettings>({ ...DEFAULT_SUPER_PANEL_SETTINGS })
const loading = ref(true)
const saving = ref(false)
const message = ref('')
const feedbackError = ref(false)
const mouseLabels = { middle: '鼠标中键', xbutton1: '鼠标侧键 1 / 后退键', xbutton2: '鼠标侧键 2 / 前进键' }
const statusLabels = { registered: '已启用', failed: '触发器未就绪', disabled: '已禁用' }
const dirty = computed(() => !!state.value && Object.entries(draft.value).some(([key, value]) => value !== state.value!.settings[key as keyof SuperPanelSettings]))
const activeDescription = computed(() => {
  const active = state.value?.activeTrigger
  return active ? mouseLabels[active.mouseButton] + (active.gesture === 'press' ? ' · 按下' : ' · 长按 ' + active.holdMilliseconds + ' ms') : ''
})
let mounted = false
let request = 0
let unsubscribe: (() => void) | undefined

function receive(value: SuperPanelSettingsStatus): void {
  const keepDraft = dirty.value
  state.value = value
  if (!keepDraft) draft.value = { ...value.settings }
  message.value = value.error ?? ''
  feedbackError.value = value.error !== null
}
async function refresh(): Promise<void> {
  if (saving.value) return
  loading.value = state.value === null
  const id = ++request
  try {
    const result = await window.desktop.superPanel.get()
    if (!mounted || id !== request) return
    if (result.ok) receive(result.data)
    else { state.value = null; message.value = result.error.message; feedbackError.value = true }
  } catch { if (mounted && id === request) { state.value = null; message.value = '无法读取 NativeHost 的 Super Panel 设置。'; feedbackError.value = true } }
  finally { if (mounted && id === request) loading.value = false }
}
async function apply(): Promise<void> {
  if (saving.value || !state.value) return
  saving.value = true
  const id = ++request
  try {
    const result = await window.desktop.superPanel.update({ ...draft.value })
    if (!mounted || id !== request) return
    if (!result.ok) { message.value = result.error.message; feedbackError.value = true; return }
    state.value = result.data
    message.value = result.data.error ?? '设置已应用。'
    feedbackError.value = result.data.error !== null
    if (result.data.error === null) draft.value = { ...result.data.settings }
  } catch { if (mounted) { message.value = '无法应用设置，请检查 NativeHost 连接。'; feedbackError.value = true } }
  finally { if (mounted) saving.value = false }
}
function cancel(): void { if (state.value) draft.value = { ...state.value.settings }; message.value = state.value?.error ?? ''; feedbackError.value = !!state.value?.error }
function defaults(): void { draft.value = { ...DEFAULT_SUPER_PANEL_SETTINGS }; message.value = '默认设置待应用。'; feedbackError.value = false }
async function focusSection(): Promise<void> {
  if (!props.focusRequestId) return
  await nextTick()
  if (!mounted) return
  section.value?.scrollIntoView({ block: 'start' })
  section.value?.focus({ preventScroll: true })
}
watch(() => props.focusRequestId, () => { void focusSection() })
onMounted(() => {
  mounted = true
  unsubscribe = window.desktop.superPanel.onChanged(status => { if (mounted) { if (!saving.value) ++request; loading.value = false; receive(status) } })
  window.addEventListener('focus', refresh)
  void refresh(); void focusSection()
})
onBeforeUnmount(() => { mounted = false; ++request; unsubscribe?.(); window.removeEventListener('focus', refresh) })
// Presentation-only navigation guard; NativeHost still owns apply/registration.
defineExpose({ hasPendingChanges: dirty, busy: saving })
</script>

<template>
  <div ref="section" class="settings-group super-panel-settings" tabindex="-1" aria-label="Super Panel 设置">
    <div class="settings-group-heading"><span class="settings-group-icon"><Mouse :size="17" /></span><div><strong>Super Panel</strong><p>通过鼠标快速操作选中的内容，应用后立即生效</p></div></div>
    <p v-if="loading" class="settings-note" role="status">正在读取 NativeHost 状态…</p>
    <template v-if="state">
      <div class="shortcut-row"><div><strong>启用 Super Panel</strong><small>Launcher 快捷键不受影响，托盘设置入口始终可用</small></div><button type="button" class="toggle-switch" :class="{ enabled: draft.enabled }" role="switch" aria-label="启用 Super Panel" :aria-checked="draft.enabled" :disabled="saving" @click="draft.enabled = !draft.enabled"><span /></button></div>
      <label class="field-label">鼠标触发按键<select v-model="draft.mouseButton" :disabled="saving || !draft.enabled"><option v-for="(label, value) in mouseLabels" :key="value" :value="value">{{ label }}</option></select></label>
      <label class="field-label">触发方式<select v-model="draft.gesture" :disabled="saving || !draft.enabled"><option value="press">按下</option><option value="hold">长按</option></select></label>
      <div v-if="draft.gesture === 'hold'" class="panel-hold"><label for="super-panel-hold">长按时间 <output>{{ draft.holdMilliseconds }} ms</output></label><input id="super-panel-hold" v-model.number="draft.holdMilliseconds" type="range" min="300" max="1500" step="50" :disabled="saving || !draft.enabled" /><div><span>300 ms</span><span>1500 ms</span></div></div>
      <p class="settings-note">选定的按下动作将用于 Super Panel；长按未达到阈值时保留普通点击。其他鼠标按键保持正常。</p>
      <div class="shortcut-row"><div><strong>英文选区自动翻译预览</strong><small>唤出面板后自动使用当前翻译引擎，译文显示在面板中</small></div><button type="button" class="toggle-switch" :class="{ enabled: draft.autoTranslationPreview }" role="switch" aria-label="英文选区自动翻译预览" :aria-checked="draft.autoTranslationPreview" :disabled="saving || !draft.enabled" @click="draft.autoTranslationPreview = !draft.autoTranslationPreview"><span /></button></div>
      <p class="settings-note">默认关闭。启用并应用后，符合条件的英文选区会发送至当前翻译服务，可能产生额度消耗或费用。使用翻译设置中保存的目标语言；来源为自动检测时按英文处理。链接、混合中文和超出服务限制的文本不会自动发送。</p>
      <p class="settings-note" aria-live="polite">当前状态：{{ statusLabels[state.triggerStatus] }}<span v-if="activeDescription">（{{ activeDescription }}）</span></p>
      <div class="panel-settings-actions"><button type="button" class="secondary-button" :disabled="saving" @click="defaults">恢复默认设置</button><div><button type="button" class="secondary-button" :disabled="saving || !dirty" @click="cancel">取消</button><button type="button" class="primary-button" :disabled="saving" @click="apply">{{ saving ? '应用中…' : '应用' }}</button></div></div>
    </template>
    <p v-if="message" :class="feedbackError ? 'inline-error' : 'settings-note'" :role="feedbackError ? 'alert' : 'status'">{{ message }}</p>
    <button v-if="!state && !loading" type="button" class="secondary-button" @click="refresh">重新读取状态</button>
  </div>
</template>

<style scoped>
.super-panel-settings { display: grid; gap: 16px; scroll-margin-top: 20px; }
.super-panel-settings > .settings-group-heading { margin-bottom: 0; }
.super-panel-settings:focus { outline: none; }
.super-panel-settings:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.panel-hold { display: grid; gap: 8px; }
.panel-hold label { font-size: 12px; font-weight: 600; }
.panel-hold label, .panel-hold > div, .panel-settings-actions, .panel-settings-actions > div { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.panel-hold output, .panel-hold > div { color: var(--muted); font-size: 11px; font-weight: 400; }
.panel-hold input { width: 100%; margin: 0; accent-color: var(--accent); }
.panel-hold input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.panel-settings-actions { flex-wrap: wrap; }
</style>
