<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BookmarkFolder } from '@/shared/domain'

const props = defineProps<{ folders: BookmarkFolder[]; websiteName: string; saving?: boolean }>()
const emit = defineEmits<{ save: [input: { folderId?: string; newFolderName?: string }]; cancel: [] }>()
const selection = ref(props.folders[0]?.id ?? '__new__')
const newFolderName = ref('')
const isNewFolder = computed(() => selection.value === '__new__')
const valid = computed(() => !isNewFolder.value || newFolderName.value.trim().length > 0)

function submit(): void {
  if (!valid.value) return
  emit('save', { folderId: isNewFolder.value ? undefined : selection.value, newFolderName: isNewFolder.value ? newFolderName.value.trim() : undefined })
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('cancel')">
    <form class="editor-dialog" @submit.prevent="submit">
      <div class="dialog-heading"><div><p class="eyebrow">整理常用入口</p><h2>添加到收藏夹</h2></div><button type="button" class="icon-button" aria-label="关闭" @click="emit('cancel')">×</button></div>
      <p class="bookmark-target-name">{{ websiteName }}</p>
      <label class="field-label">收藏夹<select v-model="selection"><option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option><option value="__new__">＋ 新建收藏夹</option></select></label>
      <label v-if="isNewFolder" class="field-label">新收藏夹名称<input v-model="newFolderName" autofocus placeholder="例如：设计灵感" /></label>
      <div class="dialog-actions"><button type="button" class="secondary-button" :disabled="saving" @click="emit('cancel')">取消</button><button type="submit" class="primary-button" :disabled="!valid || saving">{{ saving ? '正在保存…' : '添加收藏' }}</button></div>
    </form>
  </div>
</template>
