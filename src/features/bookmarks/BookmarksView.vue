<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowUpRight, Bookmark, Plus, Trash2 } from '@lucide/vue'
import type { Bookmark as BookmarkEntry, BookmarkFolder } from '@/shared/domain'
import BookmarkFolderList from './BookmarkFolderList.vue'
import BookmarkDialog from './BookmarkDialog.vue'
import Favicon from './Favicon.vue'

const folders = ref<BookmarkFolder[]>([])
const selectedId = ref('')
const bookmarks = ref<BookmarkEntry[]>([])
const dialogOpen = ref(false)
const errorMessage = ref('')
const selectedFolder = computed(() => folders.value.find((folder) => folder.id === selectedId.value))

async function loadFolders(): Promise<void> {
  folders.value = await window.desktop.listBookmarkFolders()
  if (!folders.value.some((folder) => folder.id === selectedId.value)) selectedId.value = folders.value[0]?.id ?? ''
}

async function loadBookmarks(): Promise<void> {
  bookmarks.value = selectedId.value ? await window.desktop.listBookmarks(selectedId.value) : []
}

async function createFolder(name?: string): Promise<void> {
  const folderName = name ?? window.prompt('新收藏夹名称') ?? ''
  if (!folderName.trim()) return
  const result = await window.desktop.saveBookmarkFolder({ name: folderName.trim() })
  if (!result.ok) { errorMessage.value = result.error.message; return }
  await loadFolders()
  selectedId.value = result.data.id
}

async function renameFolder(folder: BookmarkFolder): Promise<void> {
  const name = window.prompt('修改收藏夹名称', folder.name)
  if (!name?.trim()) return
  const result = await window.desktop.saveBookmarkFolder({ id: folder.id, name: name.trim() })
  if (!result.ok) errorMessage.value = result.error.message
  else await loadFolders()
}

async function removeFolder(folder: BookmarkFolder): Promise<void> {
  const count = (await window.desktop.listBookmarks(folder.id)).length
  if (!window.confirm(`删除“${folder.name}”及其中 ${count} 个收藏？`)) return
  const result = await window.desktop.deleteBookmarkFolder(folder.id)
  if (!result.ok) errorMessage.value = result.error.message
  else { await loadFolders(); await loadBookmarks() }
}

async function saveBookmark(input: { folderId?: string; newFolderName?: string; title: string; url: string }): Promise<void> {
  let folderId = input.folderId
  if (input.newFolderName) {
    const folder = await window.desktop.saveBookmarkFolder({ name: input.newFolderName })
    if (!folder.ok) { errorMessage.value = folder.error.message; return }
    folderId = folder.data.id
  }
  if (!folderId) { errorMessage.value = '请选择或新建一个收藏夹。'; return }
  const result = await window.desktop.addBookmark({ folderId, title: input.title, url: input.url })
  if (!result.ok) { errorMessage.value = result.error.message; return }
  dialogOpen.value = false
  selectedId.value = folderId
  errorMessage.value = ''
  await loadFolders()
  await loadBookmarks()
}

async function removeBookmark(bookmark: BookmarkEntry): Promise<void> {
  if (!window.confirm(`确定从“${selectedFolder.value?.name ?? '收藏夹'}”删除“${bookmark.title}”吗？`)) return
  const result = await window.desktop.deleteBookmark(bookmark.id)
  if (!result.ok) errorMessage.value = result.error.message
  else await loadBookmarks()
}

async function openBookmark(bookmark: BookmarkEntry): Promise<void> {
  const result = await window.desktop.openBookmark(bookmark.id)
  if (!result.ok) errorMessage.value = result.error.message
}

watch(selectedId, () => { void loadBookmarks() })
onMounted(() => { void loadFolders() })
</script>

<template>
  <section class="bookmarks-page">
    <BookmarkFolderList
      :folders="folders"
      :selected-id="selectedId"
      @select="selectedId = $event"
      @add="createFolder()"
      @rename="renameFolder"
      @remove="removeFolder"
    />
    <div class="bookmark-content">
      <div class="page-heading">
        <div><p class="eyebrow">留住值得再看的页面</p><h1>{{ selectedFolder?.name ?? '收藏夹' }}</h1><p class="page-description">{{ bookmarks.length }} 个网址收藏在这里</p></div>
        <button class="primary-button" :disabled="!folders.length" @click="dialogOpen = true"><Plus :size="16" /> 收藏网址</button>
      </div>
      <p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
      <div v-if="bookmarks.length" class="bookmark-grid">
        <article v-for="bookmark in bookmarks" :key="bookmark.id" class="bookmark-card">
          <Favicon :url="bookmark.url" :favicon="bookmark.favicon" />
          <div class="bookmark-copy"><strong>{{ bookmark.title }}</strong><small>{{ bookmark.url }}</small></div>
          <div class="bookmark-actions"><button class="icon-button" :aria-label="`打开${bookmark.title}`" @click="openBookmark(bookmark)"><ArrowUpRight :size="15" /></button><button class="icon-button danger" :aria-label="`删除${bookmark.title}`" @click="removeBookmark(bookmark)"><Trash2 :size="15" /></button></div>
        </article>
      </div>
      <div v-else class="empty-panel bookmark-empty"><span class="empty-orb"><Bookmark :size="18" /></span><strong>{{ selectedFolder ? '这里还没有收藏' : '创建一个收藏夹' }}</strong><span>{{ selectedFolder ? '把感兴趣的网址存进来，图标会自动获取。' : '收藏夹可以把感兴趣的网站分门别类。' }}</span><button v-if="selectedFolder" class="text-button" @click="dialogOpen = true"><Plus :size="14" /> 添加第一个网址</button><button v-else class="text-button" @click="createFolder()"><Plus :size="14" /> 新建收藏夹</button></div>
    </div>
    <BookmarkDialog v-if="dialogOpen" :folders="folders" :preferred-folder-id="selectedId" @save="saveBookmark" @cancel="dialogOpen = false" />
  </section>
</template>
