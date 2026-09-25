<script setup lang="ts">
import { Bookmark, MoreHorizontal, Plus } from '@lucide/vue'
import type { BookmarkFolder } from '@/shared/domain'

defineProps<{ folders: BookmarkFolder[]; selectedId: string }>()
defineEmits<{
  select: [id: string]
  add: []
  rename: [folder: BookmarkFolder]
  remove: [folder: BookmarkFolder]
}>()
</script>

<template>
  <div class="folder-sidebar">
    <div class="folder-heading"><span>我的收藏夹</span><button class="icon-button" aria-label="新建收藏夹" @click="$emit('add')"><Plus :size="15" /></button></div>
    <div v-for="folder in folders" :key="folder.id" class="folder-row" :class="{ selected: selectedId === folder.id }">
      <button class="folder-select" @click="$emit('select', folder.id)"><Bookmark :size="15" /><span>{{ folder.name }}</span></button>
      <details class="folder-menu">
        <summary aria-label="收藏夹菜单"><MoreHorizontal :size="15" /></summary>
        <div class="folder-menu-pop"><button @click="$emit('rename', folder)">重命名</button><button class="danger" @click="$emit('remove', folder)">删除</button></div>
      </details>
    </div>
    <div v-if="!folders.length" class="folder-empty">创建收藏夹<br />整理感兴趣的网站</div>
  </div>
</template>
