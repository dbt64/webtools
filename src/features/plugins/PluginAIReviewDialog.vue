<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { CircleAlert, Send, X } from '@lucide/vue'
import type { IpcResult } from '../../shared/ipc.ts'
import type { PluginAIReviewDTO, PluginActionResult } from '../../shared/plugin-contracts.ts'

const props = defineProps<{ review: PluginAIReviewDTO | null }>()
const emit = defineEmits<{ completed: [result: IpcResult<PluginActionResult>]; cancelled: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const busy = ref(false)
const error = ref('')
let previousFocus: HTMLElement | null = null

watch(() => props.review, async review => {
  error.value = ''
  if (review) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    const element = dialog.value
    if (element && !element.open) element.showModal()
    cancelButton.value?.focus()
  } else {
    if (dialog.value?.open) dialog.value.close()
    await nextTick()
    previousFocus?.focus()
    previousFocus = null
  }
}, { immediate: true })

async function cancel(): Promise<void> {
  const reviewId = props.review?.reviewId
  if (!reviewId || busy.value) return
  busy.value = true
  try { await window.desktop.plugins.cancelAIReview(reviewId) }
  finally { busy.value = false; emit('cancelled') }
}

async function confirm(): Promise<void> {
  const review = props.review
  if (!review || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await window.desktop.plugins.confirmAIReview(review.reviewId)
    if (result.ok) emit('completed', result)
    else error.value = result.error.code === 'USER_CONFIRMATION_REQUIRED'
      ? '此预览已失效或共享 AI 设置已变化。请关闭后重新检查完整请求。'
      : result.error.message
  } catch { error.value = '发送没有完成；请检查共享 AI 设置后重试。' }
  finally { busy.value = false }
}

function onCancel(event: Event): void { event.preventDefault(); void cancel() }
onBeforeUnmount(() => {
  if (props.review) void window.desktop.plugins.cancelAIReview(props.review.reviewId)
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog ref="dialog" class="plugin-review-dialog" aria-labelledby="plugin-review-title" aria-describedby="plugin-review-description" @cancel="onCancel">
    <div v-if="review" class="plugin-review-shell">
      <header class="plugin-review-heading"><div><p class="eyebrow">共享 AI 请求</p><h2 id="plugin-review-title">发送前检查内容</h2></div><button ref="cancelButton" type="button" class="icon-button" aria-label="取消并关闭预览" :disabled="busy" @click="cancel"><X :size="16" /></button></header>
      <p id="plugin-review-description" class="plugin-review-notice">以下完整消息将发送给当前共享 AI 提供方。插件不会获得 API Key 或 SecretStore 内容。</p>
      <dl class="plugin-review-facts">
        <div><dt>插件</dt><dd>{{ review.pluginName }} · {{ review.version }}</dd></div>
        <div><dt>申请的能力</dt><dd>使用共享 AI</dd></div>
        <div><dt>提供方 / 模型</dt><dd>{{ review.providerName }} · {{ review.model }}</dd></div>
        <div><dt>消息 / 字符</dt><dd>{{ review.messageCount }} 条 · {{ review.characterCount }} 个字符</dd></div>
      </dl>
      <section class="plugin-review-messages" aria-label="将发送的完整消息">
        <article v-for="(message, index) in review.messages" :key="`${index}-${message.role}`" class="plugin-review-message">
          <h3>{{ message.role === 'system' ? '系统消息' : message.role === 'assistant' ? '助手消息' : '用户消息' }}</h3>
          <pre>{{ message.content }}</pre>
        </article>
      </section>
      <p v-if="error" class="inline-error plugin-review-error" role="alert"><CircleAlert :size="15" />{{ error }}</p>
      <footer class="plugin-review-actions"><button type="button" class="secondary-button" :disabled="busy" @click="cancel">取消</button><button type="button" class="primary-button" :disabled="busy" @click="confirm"><Send :size="14" />{{ busy ? '正在发送…' : '确认并发送' }}</button></footer>
    </div>
  </dialog>
</template>

<style scoped>
.plugin-review-dialog { width: min(760px, calc(100vw - 32px)); max-width: 760px; max-height: min(88vh, 900px); padding: 0; border: 1px solid var(--line); border-radius: 12px; color: var(--text); background: var(--canvas); box-shadow: 0 24px 80px #0008; }
.plugin-review-dialog::backdrop { background: #0009; }
.plugin-review-shell { display: grid; max-height: 88vh; grid-template-rows: auto auto auto minmax(120px, 1fr) auto auto; gap: 14px; padding: 20px; }
.plugin-review-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.plugin-review-heading h2 { margin: 5px 0 0; font-size: 18px; }
.plugin-review-heading .eyebrow { margin: 0; color: var(--muted); font-size: 10px; }
.plugin-review-notice { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.plugin-review-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px 18px; padding: 12px; margin: 0; border-radius: 8px; background: var(--surface); }
.plugin-review-facts dt { margin-bottom: 4px; color: var(--muted); font-size: 9px; }
.plugin-review-facts dd { overflow-wrap: anywhere; margin: 0; font-size: 10px; }
.plugin-review-messages { min-height: 140px; max-height: 48vh; overflow: auto; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.plugin-review-message + .plugin-review-message { padding-top: 13px; margin-top: 13px; border-top: 1px solid var(--line); }
.plugin-review-message h3 { margin: 0 0 7px; color: var(--muted); font-size: 10px; font-weight: 600; }
.plugin-review-message pre { overflow-wrap: anywhere; margin: 0; color: var(--text); font: inherit; font-size: 11px; line-height: 1.6; white-space: pre-wrap; }
.plugin-review-error { display: flex; align-items: flex-start; gap: 7px; margin: 0; }
.plugin-review-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 600px) { .plugin-review-shell { padding: 14px; } .plugin-review-facts { grid-template-columns: 1fr; } }
</style>
