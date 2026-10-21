<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowDownWideNarrow, Check, ChevronDown, ChevronRight, ExternalLink, FolderPlus, Globe, GripVertical, LayoutGrid, List, MoreVertical, Pencil, Plus, Search, Trash2 } from '@lucide/vue'
import type { BookmarkFolder, WebsiteCollection, WebsiteEntry, WebsiteOrderByCollection, WebsiteSaveInput } from '@/shared/domain'
import EntryEditor from '../entries/EntryEditor.vue'
import Favicon from '../bookmarks/Favicon.vue'
import FolderNameDialog from './FolderNameDialog.vue'
import DeleteConfirmationDialog from './DeleteConfirmationDialog.vue'
import { buildFavoriteSections, type FavoriteSection } from './favorites-model'

const searchQuery = ref('')
const emit = defineEmits<{ countChange: [count: number] }>()
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
const activeCollection = ref('all')
const websiteLayout = ref<'grid' | 'list'>('grid')
const savingLayout = ref(false)
const sortOrder = ref<'manual' | 'newest' | 'name'>('manual')
const categorySections = computed<FavoriteSection[]>(() => [
  sections.value.find(section => section.id === 'uncategorized') ?? { id: 'uncategorized', name: '未分类', websites: [] },
  ...sections.value.filter(section => section.id !== 'uncategorized'),
])
const orderedAllWebsites = computed(() => {
  const seen = new Set<string>()
  return categorySections.value.flatMap(section => section.websites).filter(website => {
    if (seen.has(website.id)) return false
    seen.add(website.id)
    return true
  })
})
function websiteFolders(website: WebsiteEntry): BookmarkFolder[] {
  return folders.value.filter(folder => website.folderIds.includes(folder.id))
}
function displayWebsites(entries: WebsiteEntry[]): WebsiteEntry[] {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  const result = entries.filter(website => !query || [website.name, website.url, website.description ?? '', ...websiteFolders(website).map(folder => folder.name)].join(' ').toLocaleLowerCase().includes(query))
  if (sortOrder.value === 'newest') result.sort((a, b) => b.createdAt - a.createdAt)
  if (sortOrder.value === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return result
}
const displaySections = computed<FavoriteSection[]>(() => {
  if (activeCollection.value === 'all' && !editMode.value) return [{ id: 'all', name: '全部', websites: displayWebsites(orderedAllWebsites.value) }]
  return categorySections.value.filter(section => activeCollection.value === 'all' || section.id === activeCollection.value)
    .map(section => ({ ...section, websites: displayWebsites(section.websites) }))
})
const visibleWebsiteCount = computed(() => new Set(displaySections.value.flatMap(section => section.websites.map(website => website.id))).size)
function websiteDomain(website: WebsiteEntry): string {
  try { return new URL(website.url).hostname.replace(/^www\./i, '') } catch { return website.url }
}
function toggleEditMode(): void {
  editMode.value = !editMode.value
  if (editMode.value) sortOrder.value = 'manual'
  endDrag()
}
async function changeLayout(layout: 'grid' | 'list'): Promise<void> {
  if (savingLayout.value || layout === websiteLayout.value) return
  const previous = websiteLayout.value
  websiteLayout.value = layout
  savingLayout.value = true
  try {
    const result = await window.desktop.updateSettings({ websiteLayout: layout })
    if (!result.ok) { websiteLayout.value = previous; errorMessage.value = result.error.message }
  } catch { websiteLayout.value = previous; errorMessage.value = '保存显示方式失败，请重试。' }
  finally { savingLayout.value = false }
}

async function refresh(expandFolderId?: string): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const [loadedFolders, loadedWebsites, loadedOrder, initialSettings] = await Promise.all([
      window.desktop.listBookmarkFolders(),
      window.desktop.listWebsites(),
      window.desktop.getWebsiteOrder(),
      initialized.value ? Promise.resolve(null) : window.desktop.getSettings(),
    ])
    folders.value = loadedFolders
    websites.value = loadedWebsites
    websiteOrder.value = loadedOrder
    if (initialSettings) websiteLayout.value = initialSettings.websiteLayout
    emit('countChange', loadedWebsites.length)
    if (activeCollection.value !== 'all' && activeCollection.value !== 'uncategorized' && !loadedFolders.some(folder => folder.id === activeCollection.value)) activeCollection.value = 'all'
    const nextSections = buildFavoriteSections(loadedFolders, loadedWebsites, loadedOrder)
    const liveIds = new Set(['uncategorized', ...nextSections.map((section) => section.id)])
    expandedFolders.value = initialized.value
      ? new Set([...expandedFolders.value].filter((id) => liveIds.has(id)))
      : new Set(['uncategorized', ...nextSections.map((section) => section.id)])
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
    if (created) activeCollection.value = result.data.id
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

function closeWebsiteMenu(event: MouseEvent): void {
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.closest('details')?.removeAttribute('open')
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
  const canClassify = dragSource.value.collectionKey === 'unclassified' && collection.kind === 'folder'
  if ((dragSource.value.collectionKey === collectionKey(collection) || canClassify) && event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  else if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
}

async function dropOnWebsite(section: FavoriteSection, targetId: string): Promise<void> {
  const source = dragSource.value
  const collection = collectionFor(section)
  if (source?.collectionKey === 'unclassified' && collection.kind === 'folder') {
    const folder = folders.value.find(item => item.id === collection.folderId)
    if (folder) await dropOnFolder(folder)
    return
  }
  if (!source || source.collectionKey !== collectionKey(collection) || source.websiteId === targetId || savingOrder.value) return
  // Keep hidden search matches in the persisted collection order.
  const orderedIds = (sections.value.find(item => item.id === section.id)?.websites ?? section.websites).map((website) => website.id)
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
  <section class="content-page favorites-page manager-grid-page">
    <header class="manager-page-header">
      <div class="manager-page-identity">
        <span class="manager-page-icon" aria-hidden="true"><Globe :size="22" :stroke-width="1.8" /></span>
        <div><h1>网址</h1><p class="page-description">收藏和整理常用的网站，快速打开你需要的内容。</p></div>
      </div>
      <div class="favorites-page-actions">
        <button class="secondary-button" :aria-pressed="editMode" @click="toggleEditMode">
          <Check v-if="editMode" :size="15" />
          <Pencil v-else :size="15" />
          {{ editMode ? '完成编辑' : '编辑' }}
        </button>
        <button class="secondary-button" @click="openFolderDialog()"><FolderPlus :size="15" />新建收藏夹</button>
        <button class="primary-button" @click="addWebsite(activeCollection === 'all' || activeCollection === 'uncategorized' ? undefined : activeCollection)"><Plus :size="16" />添加网址</button>
      </div>
    </header>

    <nav class="website-category-tabs" aria-label="网址分类">
      <button type="button" class="website-category-tab" :class="{ 'is-selected': activeCollection === 'all' }" :aria-pressed="activeCollection === 'all'" @click="activeCollection = 'all'">全部<span>{{ websites.length }}</span></button>
      <button
        v-for="category in categorySections" :key="category.id" type="button" class="website-category-tab"
        :class="{ 'is-selected': activeCollection === category.id, 'is-drop-target': dragOverFolderId === category.id }"
        :aria-pressed="activeCollection === category.id" :title="category.name" @click="activeCollection = category.id"
        @dragover="category.id !== 'uncategorized' && folders.find(folder => folder.id === category.id) && allowFolderDrop(folders.find(folder => folder.id === category.id)!, $event)"
        @dragleave="category.id !== 'uncategorized' && folders.find(folder => folder.id === category.id) && leaveFolder(folders.find(folder => folder.id === category.id)!, $event)"
        @drop.stop="category.id !== 'uncategorized' && folders.find(folder => folder.id === category.id) && dropOnFolder(folders.find(folder => folder.id === category.id)!)"
      >{{ category.name }}<span>{{ category.websites.length }}</span></button>
      <button type="button" class="website-category-tab website-category-add" @click="openFolderDialog()"><Plus :size="15" />新建分类</button>
    </nav>

    <div class="manager-grid-toolbar">
      <label class="manager-page-search"><Search :size="18" aria-hidden="true" /><input v-model="searchQuery" type="search" placeholder="搜索网址、分类或描述…" aria-label="搜索网址" /></label>
      <div class="manager-view-switch" role="group" aria-label="网址显示方式">
        <button type="button" :class="{ 'is-selected': websiteLayout === 'grid' }" :aria-pressed="websiteLayout === 'grid'" :disabled="savingLayout" @click="changeLayout('grid')"><LayoutGrid :size="17" />网格视图</button>
        <button type="button" :class="{ 'is-selected': websiteLayout === 'list' }" :aria-pressed="websiteLayout === 'list'" :disabled="savingLayout" @click="changeLayout('list')"><List :size="17" />列表视图</button>
      </div>
      <div class="website-sort-controls">
        <label class="website-sort"><ArrowDownWideNarrow :size="16" aria-hidden="true" /><select v-model="sortOrder" aria-label="网址排序" :disabled="editMode"><option value="manual">按手动顺序</option><option value="newest">按添加时间</option><option value="name">按名称</option></select></label>
        <span class="manager-grid-count">共 {{ visibleWebsiteCount }} 个网址</span>
      </div>
    </div>
    <p v-if="editMode" class="website-edit-note">拖动网址调整同分类内的顺序；将未分类网址拖到分类标签或收藏夹中即可归类。</p>

    <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
    <div v-if="loading" class="favorites-empty" role="status">正在加载网址…</div>
    <div v-else class="favorites-folders">
      <section
        v-for="section in displaySections"
        :key="section.id"
        class="favorite-folder"
        :class="{ 'is-drop-target': section.id !== 'uncategorized' && dragOverFolderId === section.id }"
        @dragover="section.id !== 'uncategorized' && folders.find((folder) => folder.id === section.id) && allowFolderDrop(folders.find((folder) => folder.id === section.id)!, $event)"
        @dragleave="section.id !== 'uncategorized' && folders.find((folder) => folder.id === section.id) && leaveFolder(folders.find((folder) => folder.id === section.id)!, $event)"
        @drop="section.id !== 'uncategorized' && folders.find((folder) => folder.id === section.id) && dropOnFolder(folders.find((folder) => folder.id === section.id)!)"
      >
        <div v-if="section.id !== 'all'" class="favorite-folder-heading">
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
        <div v-if="section.id === 'all' || expandedFolders.has(section.id)" class="favorite-folder-content">
          <div v-if="section.websites.length" class="manager-grid website-entry-grid" :class="{ 'is-editing': editMode, 'is-list': websiteLayout === 'list' }">
            <div
              v-for="website in section.websites"
              :key="website.id"
              class="manager-card website-entry-card"
              :class="{ 'is-dragging': dragSource?.websiteId === website.id }"
              :draggable="editMode"
              @dragstart="startDrag(website, section, $event)"
              @dragend="endDrag"
              @dragover="allowReorderDrop(section, $event)"
              @drop.stop="dropOnWebsite(section, website.id)"
            >
              <button
                class="website-entry-main"
                :title="website.name"
                :aria-label="editMode ? '编辑' + website.name : '打开' + website.name"
                @click="editMode ? editWebsite(website) : openWebsite(website)"
              >
                <span class="manager-card-icon website-entry-icon"><Favicon :url="website.url" :favicon="website.favicon" /></span>
                <span class="manager-card-copy">
                  <strong class="manager-card-title">{{ website.name }}</strong>
                  <span class="website-entry-domain" :title="website.url">{{ websiteDomain(website) }}</span>
                  <span v-if="website.description" class="manager-card-description" :title="website.description">{{ website.description }}</span>
                  <span v-if="websiteFolders(website).length" class="manager-card-meta"><span v-for="folder in websiteFolders(website).slice(0, 2)" :key="folder.id" class="website-folder-tag" :title="folder.name">{{ folder.name }}</span><span v-if="websiteFolders(website).length > 2" :title="websiteFolders(website).map(folder => folder.name).join('、')">+{{ websiteFolders(website).length - 2 }}</span></span>
                </span>
              </button>
              <div class="website-entry-actions">
                <GripVertical v-if="editMode" class="favorite-bookmark-grip" :size="15" aria-hidden="true" />
                <button type="button" class="manager-icon-action" :aria-label="`打开${website.name}`" title="在浏览器中打开" @click="openWebsite(website)"><ExternalLink :size="16" /></button>
                <details class="website-card-menu" name="website-actions">
                  <summary :aria-label="`更多${website.name}的操作`" title="更多操作"><MoreVertical :size="17" /></summary>
                  <div class="website-card-menu-content"><button type="button" @click="closeWebsiteMenu($event); editWebsite(website)"><Pencil :size="14" />编辑网址</button><button type="button" class="is-danger" @click="closeWebsiteMenu($event); deleteWebsite(website)"><Trash2 :size="14" />删除网址</button></div>
                </details>
              </div>
            </div>
          </div>
          <div v-else class="favorite-folder-empty">
            <span>{{ searchQuery.trim() ? '没有匹配的网址' : '暂无收藏网址' }}</span>
            <button v-if="!searchQuery.trim()" class="text-button" @click="addWebsite(section.id === 'uncategorized' || section.id === 'all' ? undefined : section.id)"><Plus :size="14" />添加网址</button>
          </div>
        </div>
      </section>
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
