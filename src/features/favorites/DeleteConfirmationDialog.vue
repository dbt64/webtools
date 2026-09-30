<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ title: string; message: string; saving: boolean; error: string }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const cancelButton = ref<HTMLButtonElement | null>(null)
const previousFocus = document.activeElement

function cancel(): void {
  if (!props.saving) emit('cancel')
}

onMounted(async () => {
  await nextTick()
  cancelButton.value?.focus()
})
onBeforeUnmount(() => {
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
})
</script>

<template>
  <div class="dialog-backdrop" @click.self="cancel" @keydown.esc.stop.prevent="cancel">
    <form class="editor-dialog delete-confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-message" @submit.prevent="emit('confirm')">
      <div class="dialog-heading">
        <h2 id="delete-dialog-title">{{ title }}</h2>
        <button type="button" class="icon-button" aria-label="关闭" :disabled="saving" @click="cancel">×</button>
      </div>
      <p id="delete-dialog-message">{{ message }}</p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <div class="dialog-actions">
        <button ref="cancelButton" type="button" class="secondary-button" :disabled="saving" @click="cancel">取消</button>
        <button type="submit" class="primary-button" :disabled="saving">{{ saving ? '正在删除…' : '确认删除' }}</button>
      </div>
    </form>
  </div>
</template>
