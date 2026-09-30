<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, ChevronDown, ChevronRight, FolderPlus, Globe, GripVertical, Pencil, Plus, Trash2 } from '@lucide/vue'
import type { BookmarkFolder, WebsiteCollection, WebsiteEntry, WebsiteOrderByCollection, WebsiteSaveInput } from '@/shared/domain'
import EntryEditor from '../entries/EntryEditor.vue'
import Favicon from '../bookmarks/Favicon.vue'
import FolderNameDialog from './FolderNameDialog.vue'
import DeleteConfirmationDialog from './DeleteConfirmationDialog.vue'
import { buildFavoriteSections, type FavoriteSection } from './favorites-model'

const websites = ref<WebsiteEntry[]>([])
const folders = ref<BookmarkFolder[]>([])
const websiteOrder = ref<WebsiteOrderByCollection>({ unclassified: [], folders: {} })
const expandedFolders = ref(new Set<string>())
const sections = computed(() => buildFavoriteSections(folders.value, websites.value, websiteOrder.value))
const loading = ref(true)
const initialized = ref(false)
const savingFolder = ref(false)
const folderDialogOpen = ref(false)
const folderDialogTarget = ref<BookmarkFolder | null>(null)
const folderError = ref('')
const errorMessage = ref('')
const editMode = ref(false)
const websiteEditorOpen = ref(false)
const websiteBeingEdited = ref<WebsiteEntry | null>(null)
const savingWebsite = ref(false)
const initialFolderIds = ref<string[]>([])
const dragSource = ref<{ websiteId: string; collectionKey: string } | null>(null)
const dragOverFolderId = ref<string | null>(null)
const savingOrder = ref(false)
const deletionTarget = ref<{ kind: 'folder'; folder: BookmarkFolder } | { kind: 'website'; website: WebsiteEntry } | null>(null)
const deleting = ref(false)
const deletionError = ref('')

async function refresh(expandFolderId?: string): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const [loadedFolders, loadedWebsites, loadedOrder] = await Promise.all([
      window.desktop.listBookmarkFolders(),
      window.desktop.listWebsites(),
      window.desktop.getWebsiteOrder(),
    ])
    folders.value = loadedFolders
    websites.value = loadedWebsites
    websiteOrder.value = loadedOrder
    const nextSections = buildFavoriteSections(loadedFolders, loadedWebsites, loadedOrder)
    const liveIds = new Set(nextSections.map((section) => section.id))
    expandedFolders.value = initialized.value
      ? new Set([...expandedFolders.value].filter((id) => liveIds.has(id)))
      : new Set(nextSections.map((section) => section.id))
    if (expandFolderId) expandedFolders.value = new Set([...expandedFolders.value, expandFolderId])
    initialized.value = true
  } catch {
    errorMessage.value = '网址暂时无法加载，请稍后重试。'
  } finally {
    loading.value = false
  }
}

function toggleFolder(folderId: string): void {
  const next = new Set(expandedFolders.value)
  if (next.has(folderId)) next.delete(folderId)
  else next.add(folderId)
  expandedFolders.value = next
}

function openFolderDialog(folder: BookmarkFolder | null = null): void {
  folderDialogTarget.value = folder
  folderError.value = ''
  folderDialogOpen.value = true
}

async function saveFolder(name: string): Promise<void> {
  savingFolder.value = true
  folderError.value = ''
  try {
    const result = await window.desktop.saveBookmarkFolder({ id: folderDialogTarget.value?.id, name })
    if (!result.ok) {
      folderError.value = result.error.message
      return
    }
    const created = folderDialogTarget.value === null
    folderDialogOpen.value = false
    folderDialogTarget.value = null
    await refresh(created ? result.data.id : undefined)
  } catch {
    folderError.value = '保存收藏夹失败，请重试。'
  } finally {
    savingFolder.value = false
  }
}

function deleteFolder(folder: BookmarkFolder): void {
  endDrag()
  deletionError.value = ''
  deletionTarget.value = { kind: 'folder', folder }
}

function addWebsite(folderId?: string): void {
  websiteBeingEdited.value = null
  initialFolderIds.value = folderId ? [folderId] : []
  websiteEditorOpen.value = true
  errorMessage.value = ''
}

function editWebsite(website: WebsiteEntry): void {
  websiteBeingEdited.value = website
  initialFolderIds.value = [...website.folderIds]
  websiteEditorOpen.value = true
  errorMessage.value = ''
}

async function saveWebsite(value: WebsiteSaveInput): Promise<void> {
  savingWebsite.value = true
  errorMessage.value = ''
  try {
    const input: WebsiteSaveInput = {
      id: value.id,
      name: value.name,
      url: value.url,
      description: value.description,
      favicon: value.favicon,
      folderIds: [...value.folderIds],
    }
    const result = await window.desktop.saveWebsite(input)
    if (!result.ok) {
      errorMessage.value = result.error.message
      return
    }
    websiteEditorOpen.value = false
    websiteBeingEdited.value = null
    await refresh()
  } catch {
    errorMessage.value = '保存网址失败，请重试。'
  } finally {
    savingWebsite.value = false
  }
}

function deleteWebsite(website: WebsiteEntry): void {
  endDrag()
  deletionError.value = ''
  deletionTarget.value = { kind: 'website', website }
}

async function confirmDeletion(): Promise<void> {
  const target = deletionTarget.value
  if (!target || deleting.value) return
  deleting.value = true
  deletionError.value = ''
  try {
    const result = target.kind === 'folder'
      ? await window.desktop.deleteBookmarkFolder(target.folder.id)
      : await window.desktop.deleteWebsite(target.website.id)
    if (!result.ok) {
      deletionError.value = result.error.message
      return
    }
    deletionTarget.value = null
    await refresh()
  } catch {
    deletionError.value = '删除失败，请重试。'
  } finally {
    deleting.value = false
  }
}

async function openWebsite(website: WebsiteEntry): Promise<void> {
  try {
    const result = await window.desktop.openWebsite(website.id)
    if (!result.ok) errorMessage.value = result.error.message
  } catch {
    errorMessage.value = '打开网址失败，请重试。'
  }
}

function collectionFor(section: FavoriteSection): WebsiteCollection {
  return section.id === 'uncategorized' ? { kind: 'unclassified' } : { kind: 'folder', folderId: section.id }
}

function collectionKey(collection: WebsiteCollection): string {
  return collection.kind === 'unclassified' ? 'unclassified' : `folder:${collection.folderId}`
}

function startDrag(website: WebsiteEntry, section: FavoriteSection, event: DragEvent): void {
  if (!editMode.value || savingOrder.value || !event.dataTransfer) {
    event.preventDefault()
    return
  }
  const collection = collectionFor(section)
  dragSource.value = { websiteId: website.id, collectionKey: collectionKey(collection) }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', website.id)
}

function endDrag(): void {
  dragSource.value = null
  dragOverFolderId.value = null
}

function allowReorderDrop(section: FavoriteSection, event: DragEvent): void {
  if (!editMode.value || !dragSource.value) return
  event.preventDefault()
  const collection = collectionFor(section)
  if (dragSource.value.collectionKey === collectionKey(collection) && event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  else if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
}

async function dropOnWebsite(section: FavoriteSection, targetId: string): Promise<void> {
  const source = dragSource.value
  const collection = collectionFor(section)
  if (!source || source.collectionKey !== collectionKey(collection) || source.websiteId === targetId || savingOrder.value) return
  const orderedIds = section.websites.map((website) => website.id)
  const sourceIndex = orderedIds.indexOf(source.websiteId)
  const targetIndex = orderedIds.indexOf(targetId)
  if (sourceIndex < 0 || targetIndex < 0) return
  orderedIds.splice(sourceIndex, 1)
  orderedIds.splice(targetIndex, 0, source.websiteId)
  savingOrder.value = true
  errorMessage.value = ''
  try {
    const result = await window.desktop.reorderWebsites(collection, orderedIds)
    if (!result.ok) {
      errorMessage.value = result.error.message
      return
    }
    websiteOrder.value = result.data
  } catch {
    errorMessage.value = '保存网址顺序失败，请重试。'
  } finally {
    savingOrder.value = false
    endDrag()
  }
}

function allowFolderDrop(folder: BookmarkFolder, event: DragEvent): void {
  if (!editMode.value || dragSource.value?.collectionKey !== 'unclassified') return
  event.preventDefault()
  dragOverFolderId.value = folder.id
}

function leaveFolder(folder: BookmarkFolder, event: DragEvent): void {
  const current = event.currentTarget
  const related = event.relatedTarget
  if (current instanceof HTMLElement && related instanceof Node && current.contains(related)) return
  if (dragOverFolderId.value === folder.id) dragOverFolderId.value = null
}

async function dropOnFolder(folder: BookmarkFolder): Promise<void> {
  const source = dragSource.value
  if (!source || source.collectionKey !== 'unclassified') return
  dragOverFolderId.value = null
  errorMessage.value = ''
  try {
    const result = await window.desktop.addWebsiteToFolders(source.websiteId, [folder.id])
    if (!result.ok) {
      errorMessage.value = result.error.message
      return
    }
    await refresh()
  } catch {
    errorMessage.value = '移动网址失败，请重试。'
  } finally {
    endDrag()
  }
}

onMounted(() => { void refresh() })
</script>

<template>
  <section class="content-page favorites-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">常用入口</p>
        <h1>网址</h1>
        <p class="page-description">按收藏夹整理常访问的网站，点击即可打开。</p>
      </div>
      <div class="favorites-page-actions">
        <button class="secondary-button" :aria-pressed="editMode" @click="editMode = !editMode; endDrag()">
          <Check v-if="editMode" :size="15" />
          <Pencil v-else :size="15" />
          {{ editMode ? '完成编辑' : '编辑' }}
        </button>
        <button class="secondary-button" @click="openFolderDialog()"><FolderPlus :size="15" />新建收藏夹</button>
        <button class="primary-button" @click="addWebsite()"><Plus :size="16" />添加网址</button>
      </div>
    </div>

    <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
    <div v-if="loading" class="favorites-empty" role="status">正在加载网址…</div>
    <div v-else-if="sections.length" class="favorites-folders">
      <section
        v-for="section in sections"
        :key="section.id"
        class="favorite-folder"
        :class="{ 'is-drop-target': section.id !== 'uncategorized' && dragOverFolderId === section.id }"
        @dragover="section.id !== 'uncategorized' && folders.find((folder) => folder.id === section.id) && allowFolderDrop(folders.find((folder) => folder.id === section.id)!, $event)"
        @dragleave="section.id !== 'uncategorized' && folders.find((folder) => folder.id === section.id) && leaveFolder(folders.find((folder) => folder.id === section.id)!, $event)"
        @drop="section.id !== 'uncategorized' && folders.find((folder) => folder.id === section.id) && dropOnFolder(folders.find((folder) => folder.id === section.id)!)"
      >
        <div class="favorite-folder-heading">
          <button
            class="favorite-folder-toggle"
            :aria-expanded="expandedFolders.has(section.id)"
            @click="toggleFolder(section.id)"
          >
            <ChevronDown v-if="expandedFolders.has(section.id)" :size="16" aria-hidden="true" />
            <ChevronRight v-else :size="16" aria-hidden="true" />
            <span>{{ section.name }}</span>
            <small>{{ section.websites.length }}</small>
          </button>
          <div v-if="editMode && section.id !== 'uncategorized'" class="favorite-folder-actions">
            <button class="icon-button" :aria-label="`重命名${section.name}`" title="重命名收藏夹" @click="openFolderDialog(folders.find((folder) => folder.id === section.id) ?? null)"><Pencil :size="13" /></button>
            <button class="icon-button danger" :aria-label="`删除${section.name}`" title="删除收藏夹" @click="deleteFolder(folders.find((folder) => folder.id === section.id)!)"><Trash2 :size="13" /></button>
          </div>
        </div>
        <div v-if="expandedFolders.has(section.id)" class="favorite-folder-content">
          <div v-if="section.websites.length" class="favorite-bookmark-grid" :class="{ 'is-editing': editMode }">
            <div
              v-for="website in section.websites"
              :key="website.id"
              class="favorite-bookmark-item"
              :class="{ 'is-dragging': dragSource?.websiteId === website.id }"
              :draggable="editMode"
              @dragstart="startDrag(website, section, $event)"
              @dragend="endDrag"
              @dragover="allowReorderDrop(section, $event)"
              @drop="dropOnWebsite(section, website.id)"
            >
              <button
                class="favorite-bookmark"
                :title="website.name"
                :aria-label="editMode ? '编辑' + website.name : '打开' + website.name"
                @click="editMode ? editWebsite(website) : openWebsite(website)"
              >
                <span class="favorite-bookmark-icon"><Favicon :url="website.url" :favicon="website.favicon" /></span>
                <span class="favorite-bookmark-title">{{ website.name }}</span>
              </button>
              <div v-if="editMode" class="favorite-bookmark-actions">
                <GripVertical class="favorite-bookmark-grip" :size="13" aria-hidden="true" />
                <button class="icon-button" :aria-label="`编辑${website.name}`" title="编辑网址" @click="editWebsite(website)"><Pencil :size="12" /></button>
                <button class="icon-button danger" :aria-label="`删除${website.name}`" title="删除网址" @click="deleteWebsite(website)"><Trash2 :size="12" /></button>
              </div>
            </div>
          </div>
          <div v-else class="favorite-folder-empty">
            <span>暂无收藏网址</span>
            <button class="text-button" @click="addWebsite(section.id === 'uncategorized' ? undefined : section.id)"><Plus :size="14" />添加网址</button>
          </div>
        </div>
      </section>
    </div>
    <div v-else class="favorites-empty">
      <span class="empty-orb"><Globe :size="18" /></span>
      <strong>暂无收藏网址</strong>
      <span>添加网址或创建收藏夹，整理你的常用入口。</span>
      <div class="favorites-page-actions">
        <button class="secondary-button" @click="openFolderDialog()"><FolderPlus :size="15" />新建收藏夹</button>
        <button class="primary-button" @click="addWebsite()"><Plus :size="16" />添加网址</button>
      </div>
    </div>

    <DeleteConfirmationDialog
      v-if="deletionTarget"
      :title="deletionTarget.kind === 'folder' ? '删除收藏夹' : '删除网址'"
      :message="deletionTarget.kind === 'folder'
        ? `确定删除收藏夹“${deletionTarget.folder.name}”吗？网址会保留，仅属于此收藏夹的网址将移入未分类。`
        : `确定删除“${deletionTarget.website.name}”吗？`"
      :saving="deleting"
      :error="deletionError"
      @confirm="confirmDeletion"
      @cancel="deletionTarget = null"
    />
    <FolderNameDialog
      v-if="folderDialogOpen"
      :key="folderDialogTarget?.id ?? 'new-folder'"
      :saving="savingFolder"
      :error="folderError"
      :initial-name="folderDialogTarget?.name"
      :dialog-title="folderDialogTarget ? '重命名收藏夹' : '新建收藏夹'"
      :submit-label="folderDialogTarget ? '保存名称' : '创建收藏夹'"
      @save="saveFolder"
      @cancel="folderDialogOpen = false"
    />
    <EntryEditor
      v-if="websiteEditorOpen"
      :entry="websiteBeingEdited ?? undefined"
      :folders="folders"
      :initial-folder-ids="initialFolderIds"
      :saving="savingWebsite"
      @save="saveWebsite"
      @cancel="websiteEditorOpen = false"
    />
  </section>
</template>
