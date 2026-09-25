<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { ToolEntry, WebEntry } from '@/shared/domain'

const props = defineProps<{
  kind: 'website' | 'tool'
  entry?: WebEntry | ToolEntry
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [value: { id?: string; name: string; url?: string; command?: string; description?: string }]
  cancel: []
}>()

const form = reactive({
  name: props.entry?.name ?? '',
  url: props.entry && 'url' in props.entry ? props.entry.url : '',
  command: props.entry && 'command' in props.entry ? props.entry.command : '',
  description: props.entry?.description ?? '',
})

const valid = computed(() => form.name.trim().length > 0 && (props.kind === 'website' ? form.url.trim().length > 0 : form.command.trim().length > 0))

function submit(): void {
  if (!valid.value) return
  emit('save', {
    id: props.entry?.id,
    name: form.name.trim(),
    ...(props.kind === 'website' ? { url: form.url.trim() } : { command: form.command.trim() }),
    description: form.description.trim() || undefined,
  })
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('cancel')">
    <form class="editor-dialog" @submit.prevent="submit">
      <div class="dialog-heading">
        <div><p class="eyebrow">{{ entry ? '编辑资料' : '添加到你的空间' }}</p><h2>{{ entry ? '编辑' : '添加' }}{{ kind === 'website' ? '网址' : '工具' }}</h2></div>
        <button type="button" class="icon-button" aria-label="关闭" @click="emit('cancel')">×</button>
      </div>
      <label class="field-label">显示名称<input v-model="form.name" autofocus placeholder="例如：设计灵感" /></label>
      <label v-if="kind === 'website'" class="field-label">网址<input v-model="form.url" inputmode="url" placeholder="https://example.com" /></label>
      <label v-else class="field-label">程序路径<input v-model="form.command" placeholder="C:\\Program Files\\App\\App.exe" /></label>
      <label class="field-label">备注（可选）<input v-model="form.description" placeholder="帮助你记起它的用途" /></label>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" :disabled="saving" @click="emit('cancel')">取消</button>
        <button type="submit" class="primary-button" :disabled="!valid || saving">{{ saving ? '正在保存…' : '保存' }}</button>
      </div>
    </form>
  </div>
</template>
