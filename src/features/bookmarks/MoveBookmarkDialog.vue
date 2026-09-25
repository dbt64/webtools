<script setup lang="ts">
import { ref } from 'vue'
import type { BookmarkFolder } from '@/shared/domain'

const props = defineProps<{ folders: BookmarkFolder[]; currentFolderId: string }>()
const emit = defineEmits<{ move: [folderId: string]; cancel: [] }>()
const targetFolderId = ref(props.folders.find((folder) => folder.id !== props.currentFolderId)?.id ?? '')
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('cancel')">
    <form class="editor-dialog" @submit.prevent="targetFolderId && emit('move', targetFolderId)">
      <div class="dialog-heading"><div><p class="eyebrow">整理收藏</p><h2>移动到收藏夹</h2></div><button type="button" class="icon-button" aria-label="关闭" @click="emit('cancel')">×</button></div>
      <label class="field-label">目标收藏夹<select v-model="targetFolderId"><option v-for="folder in folders.filter((item) => item.id !== currentFolderId)" :key="folder.id" :value="folder.id">{{ folder.name }}</option></select></label>
      <div class="dialog-actions"><button type="button" class="secondary-button" @click="emit('cancel')">取消</button><button type="submit" class="primary-button" :disabled="!targetFolderId">移动</button></div>
    </form>
  </div>
</template>
