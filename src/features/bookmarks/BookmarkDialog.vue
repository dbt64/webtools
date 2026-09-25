<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BookmarkFolder } from '@/shared/domain'

const props = defineProps<{
  folders: BookmarkFolder[]
  initialTitle?: string
  initialUrl?: string
  preferredFolderId?: string
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [input: { folderId?: string; newFolderName?: string; title: string; url: string }]
  cancel: []
}>()

const title = ref(props.initialTitle ?? '')
const url = ref(props.initialUrl ?? '')
const selection = ref(props.preferredFolderId ?? props.folders[0]?.id ?? '__new__')
const newFolderName = ref('')
const isNewFolder = computed(() => selection.value === '__new__')
const valid = computed(() => url.value.trim().length > 0 && (!isNewFolder.value || newFolderName.value.trim().length > 0))

function submit(): void {
  if (!valid.value) return
  emit('save', {
    folderId: isNewFolder.value ? undefined : selection.value,
    newFolderName: isNewFolder.value ? newFolderName.value.trim() : undefined,
    title: title.value.trim(),
    url: url.value.trim(),
  })
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('cancel')">
    <form class="editor-dialog" @submit.prevent="submit">
      <div class="dialog-heading"><div><p class="eyebrow">保存到你的空间</p><h2>收藏网址</h2></div><button type="button" class="icon-button" aria-label="关闭" @click="emit('cancel')">×</button></div>
      <label class="field-label">网址<input v-model="url" autofocus inputmode="url" placeholder="https://example.com" /></label>
      <label class="field-label">显示名称（可选）<input v-model="title" placeholder="默认使用网站域名" /></label>
      <label class="field-label">收藏夹<select v-model="selection"><option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option><option value="__new__">＋ 新建收藏夹</option></select></label>
      <label v-if="isNewFolder" class="field-label">新收藏夹名称<input v-model="newFolderName" placeholder="例如：设计灵感" /></label>
      <p v-if="saving" class="save-progress">正在保存并获取网站图标…</p>
      <div class="dialog-actions"><button type="button" class="secondary-button" :disabled="saving" @click="emit('cancel')">取消</button><button type="submit" class="primary-button" :disabled="!valid || saving">{{ saving ? '正在保存…' : '收藏' }}</button></div>
    </form>
  </div>
</template>
