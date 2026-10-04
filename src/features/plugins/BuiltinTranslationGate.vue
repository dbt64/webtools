<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { CircleAlert, Languages, Puzzle, ShieldCheck } from '@lucide/vue'
import type { BuiltinTranslationHandoffProjection } from '../../shared/builtin-translation-contracts.ts'

type BlockedHandoff = Extract<BuiltinTranslationHandoffProjection, { status: 'blocked' }>

const props = defineProps<{ handoff: BlockedHandoff; busy?: boolean; error?: string }>()
const emit = defineEmits<{
  presented: [handoff: BlockedHandoff]
  enableAndOpen: [handoff: BlockedHandoff]
  cancel: [handoff: BlockedHandoff]
  manage: []
}>()

const canEnable = computed(() => props.handoff.reason === 'disabled'
  || (props.handoff.reason === 'faulted' && props.handoff.retryEnabled === true))
const statusText = computed(() => {
  switch (props.handoff.reason) {
    case 'disabled': return '内置翻译当前已停用。'
    case 'faulted': return `翻译状态写入失败（${props.handoff.errorCode ?? '未知错误'}）。`
    case 'unavailable': return `内置翻译状态无法安全读取（${props.handoff.errorCode ?? '未知错误'}）。`
    case 'transitioning': return '正在保存翻译状态，请稍候。'
  }
})

onMounted(() => emit('presented', props.handoff))
</script>

<template>
  <section class="content-page builtin-translation-gate" aria-labelledby="translation-gate-title">
    <div class="page-heading">
      <div>
        <p class="eyebrow">应用扩展</p>
        <h1 id="translation-gate-title">打开翻译</h1>
        <p class="page-description">{{ statusText }}</p>
      </div>
      <div class="translation-gate-icon" aria-hidden="true"><Languages :size="22" /></div>
    </div>

    <div class="translation-gate-panel" role="status" aria-live="polite">
      <CircleAlert v-if="handoff.reason === 'unavailable' || handoff.reason === 'faulted'" :size="18" />
      <ShieldCheck v-else :size="18" />
      <div>
        <strong>{{ handoff.hasPrefill ? '原始输入已由 WebTools 暂存' : '翻译页面尚未打开' }}</strong>
        <p>选择启用后才会进入翻译页。启用后，页面会按当前翻译设置自动开始处理输入；在此之前不会调用翻译服务。</p>
      </div>
    </div>

    <p v-if="error" class="translation-gate-error" role="alert" aria-live="assertive">{{ error }}</p>

    <div class="translation-gate-actions">
      <button v-if="canEnable" class="primary-button" :disabled="busy" @click="emit('enableAndOpen', handoff)">
        <Languages :size="15" />{{ busy ? '正在启用…' : '启用并打开翻译' }}
      </button>
      <button v-else-if="handoff.reason === 'unavailable' || handoff.reason === 'faulted'" class="secondary-button" :disabled="busy" @click="emit('manage')">
        <Puzzle :size="15" />前往插件管理
      </button>
      <button v-else class="secondary-button" disabled>等待状态保存…</button>
      <button class="secondary-button" :disabled="busy" @click="emit('cancel', handoff)">取消</button>
    </div>
  </section>
</template>

<style scoped>
.translation-gate-icon { display: grid; width: 44px; height: 44px; flex: 0 0 auto; place-items: center; border-radius: 10px; color: var(--accent); background: var(--accent-soft); }
.translation-gate-panel { display: flex; max-width: 720px; align-items: flex-start; gap: 11px; padding: 14px; border-radius: 9px; color: var(--accent); background: var(--surface); }
.translation-gate-panel > div { display: grid; gap: 5px; }
.translation-gate-panel strong { color: var(--text); font-size: 11px; font-weight: 600; }
.translation-gate-panel p { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.6; }
.translation-gate-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.translation-gate-error { max-width: 720px; padding: 10px 12px; margin: 12px 0 0; border-radius: 7px; color: #e69b93; background: color-mix(in srgb, #a8483e 14%, var(--surface)); font-size: 10px; line-height: 1.5; }
</style>
