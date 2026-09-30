<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

const props = defineProps<{ saving?: boolean; error?: string; initialName?: string; dialogTitle?: string; submitLabel?: string }>()
const emit = defineEmits<{ save: [name: string]; cancel: [] }>()
const name = ref(props.initialName ?? '')
const nameInput = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  await nextTick()
  nameInput.value?.focus()
})

function submit(): void {
  const value = name.value.trim()
  if (value) emit('save', value)
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('cancel')">
    <form class="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" @submit.prevent="submit">
      <div class="dialog-heading">
        <div><p class="eyebrow">整理收藏网址</p><h2 id="folder-dialog-title">{{ props.dialogTitle ?? '新建收藏夹' }}</h2></div>
        <button type="button" class="icon-button" aria-label="关闭" :disabled="saving" @click="emit('cancel')">×</button>
      </div>
      <label class="field-label">收藏夹名称<input ref="nameInput" v-model="name" maxlength="80" placeholder="例如：综合常用" /></label>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" :disabled="saving" @click="emit('cancel')">取消</button>
        <button type="submit" class="primary-button" :disabled="!name.trim() || saving">{{ saving ? '正在保存…' : props.submitLabel ?? '创建收藏夹' }}</button>
      </div>
    </form>
  </div>
</template>
