<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Folder, Globe, LayoutGrid, List, Pencil, Plus, Trash2 } from '@lucide/vue'
import type { BookmarkFolder, WebsiteEntry, WebsiteSaveInput } from '@/shared/domain'
import EntryEditor from './EntryEditor.vue'
import Favicon from '../bookmarks/Favicon.vue'

const websites = ref<WebsiteEntry[]>([])
const folders = ref<BookmarkFolder[]>([])
const selectedFolder = ref<string | undefined>()
const layout = ref<'grid' | 'list'>('grid')
const editing = ref(false)
const saving = ref(false)
const current = ref<WebsiteEntry>()
const errorMessage = ref('')
const visibleWebsites = computed(() => selectedFolder.value ? websites.value.filter((website) => website.folderIds.includes(selectedFolder.value!)) : websites.value)

async function refresh(): Promise<void> {
  const [loaded, loadedFolders, settings] = await Promise.all([window.desktop.listWebsites(), window.desktop.listBookmarkFolders(), window.desktop.getSettings()])
  websites.value = loaded
  folders.value = loadedFolders
  layout.value = settings.websiteLayout
}

function edit(website?: WebsiteEntry): void { current.value = website; editing.value = true }

async function save(value: WebsiteSaveInput): Promise<void> {
  saving.value = true
  try {
    // Vue deeply wraps folderIds in a Proxy; Electron IPC's structured clone
    // cannot serialize proxies, so send a plain DTO across the process boundary.
    const input: WebsiteSaveInput = {
      id: value.id,
      name: value.name,
      url: value.url,
      description: value.description,
      favicon: value.favicon,
      folderIds: [...value.folderIds],
    }
    const result = await window.desktop.saveWebsite(input)
    if (!result.ok) { errorMessage.value = result.error.message; return }
    editing.value = false
    errorMessage.value = ''
    try { await refresh() } catch { errorMessage.value = '网址已保存，但列表刷新失败；请重新进入网址页面。' }
  } catch { errorMessage.value = '保存请求失败，请重试。' } finally { saving.value = false }
}

async function open(website: WebsiteEntry): Promise<void> {
  const result = await window.desktop.openWebsite(website.id)
  if (!result.ok) errorMessage.value = result.error.message
}

async function remove(website: WebsiteEntry): Promise<void> {
  if (!window.confirm(`确定删除“${website.name}”吗？`)) return
  const result = await window.desktop.deleteWebsite(website.id)
  if (!result.ok) errorMessage.value = result.error.message
  else await refresh()
}

async function addFolder(): Promise<void> {
  const name = window.prompt('收藏夹名称')?.trim()
  if (!name) return
  const result = await window.desktop.saveBookmarkFolder({ name })
  if (!result.ok) { errorMessage.value = result.error.message; return }
  await refresh()
}

async function deleteFolder(folder: BookmarkFolder): Promise<void> {
  if (!window.confirm(`删除收藏夹“${folder.name}”？其中的网址会保留。`)) return
  const result = await window.desktop.deleteBookmarkFolder(folder.id)
  if (!result.ok) errorMessage.value = result.error.message
  else { if (selectedFolder.value === folder.id) selectedFolder.value = undefined; await refresh() }
}

async function renameFolder(folder: BookmarkFolder): Promise<void> {
  const name = window.prompt('收藏夹名称', folder.name)?.trim()
  if (!name || name === folder.name) return
  const result = await window.desktop.saveBookmarkFolder({ id: folder.id, name })
  if (!result.ok) errorMessage.value = result.error.message
  else await refresh()
}

async function setLayout(next: 'grid' | 'list'): Promise<void> {
  layout.value = next
  const result = await window.desktop.updateSettings({ websiteLayout: next })
  if (!result.ok) errorMessage.value = result.error.message
}

onMounted(() => { void refresh() })
</script>

<template>
  <section class="content-page website-page">
    <div class="page-heading">
      <div><p class="eyebrow">收好常用入口</p><h1>网址</h1><p class="page-description">保存常访问的网站，在收藏夹里整理和筛选。</p></div>
      <button class="primary-button" @click="edit()"><Plus :size="16" /> 添加网址</button>
    </div>

    <div class="website-toolbar">
      <div class="website-folders">
        <button class="folder-chip" :class="{ selected: !selectedFolder }" @click="selectedFolder = undefined">全部 <span>{{ websites.length }}</span></button>
        <div v-for="folder in folders" :key="folder.id" class="folder-chip-wrap">
          <button class="folder-chip" :class="{ selected: selectedFolder === folder.id }" @click="selectedFolder = folder.id"><Folder :size="13" />{{ folder.name }}<span>{{ websites.filter((site) => site.folderIds.includes(folder.id)).length }}</span></button>
          <span class="folder-actions"><button class="folder-remove folder-rename" :aria-label="`重命名${folder.name}`" title="重命名" @click.stop="renameFolder(folder)"><Pencil :size="10" /></button><button class="folder-remove" :aria-label="`删除${folder.name}`" title="删除收藏夹" @click.stop="deleteFolder(folder)">×</button></span>
        </div>
        <button class="folder-add" @click="addFolder"><Plus :size="14" /> 新建收藏夹</button>
      </div>
      <div class="layout-switch" aria-label="排布模式">
        <button :class="{ selected: layout === 'grid' }" aria-label="网格模式" @click="setLayout('grid')"><LayoutGrid :size="15" /></button>
        <button :class="{ selected: layout === 'list' }" aria-label="列表模式" @click="setLayout('list')"><List :size="15" /></button>
      </div>
    </div>

    <p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
    <div v-if="visibleWebsites.length" class="website-collection" :class="`layout-${layout}`">
      <article v-for="website in visibleWebsites" :key="website.id" class="website-card" role="link" tabindex="0" @click="open(website)" @keydown.enter="open(website)">
        <span class="website-favicon">
          <Favicon :url="website.url" :favicon="website.favicon" />
        </span>
        <span class="website-copy"><strong>{{ website.name }}</strong><small>{{ website.url }}</small><em v-if="website.description">{{ website.description }}</em></span>
        <span class="website-actions" @click.stop>
          <button class="icon-button" :aria-label="`编辑${website.name}`" @click="edit(website)"><Pencil :size="15" /></button>
          <button class="icon-button danger" :aria-label="`删除${website.name}`" @click="remove(website)"><Trash2 :size="15" /></button>
        </span>
      </article>
    </div>
    <div v-else class="empty-panel"><span class="empty-orb"><Globe :size="18" /></span><strong>{{ selectedFolder ? '这个收藏夹还没有网址' : '这里还没有网址' }}</strong><span>添加网址后，可在快速搜索和收藏夹中随时打开。</span><button class="text-button" @click="edit()"><Plus :size="14" /> 添加网址</button></div>

    <EntryEditor v-if="editing" :entry="current" :folders="folders" :saving="saving" @save="save" @cancel="editing = false" />
  </section>
</template>
