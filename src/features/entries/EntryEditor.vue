<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { WebsiteEntry } from '@/shared/domain'
import type { BookmarkFolder } from '@/shared/domain'

const props = defineProps<{ entry?: WebsiteEntry; folders: BookmarkFolder[]; saving?: boolean }>()
const emit = defineEmits<{ save: [value: { id?: string; name: string; url: string; description?: string; favicon?: string; folderIds: string[] }]; cancel: [] }>()
const form = reactive({ name: props.entry?.name ?? '', url: props.entry?.url ?? '', description: props.entry?.description ?? '' })
const favicon = ref(props.entry?.favicon)
const folderIds = ref([...(props.entry?.folderIds ?? [])])
const fetchedTitle = ref('')
const metadataLoading = ref(false)
const metadataMessage = ref('')
const valid = computed(() => form.url.trim().length > 0)

async function fetchMetadata(): Promise<void> {
  if (!form.url.trim()) return
  metadataLoading.value = true
  metadataMessage.value = ''
  try {
    const result = await window.desktop.fetchWebsiteMetadata(form.url.trim())
    if (result.ok) {
      if (!props.entry && !form.name.trim() && result.data.title) form.name = result.data.title
      if (result.data.title) fetchedTitle.value = result.data.title
      if (result.data.favicon) favicon.value = result.data.favicon
      metadataMessage.value = result.data.title ? '已读取网站标题' : result.data.favicon ? '已获取网站图标' : '可手动填写网站名称'
    } else metadataMessage.value = result.error.message
  } catch { metadataMessage.value = '暂时无法读取网站信息，可继续手动填写。' }
  finally { metadataLoading.value = false }
}

async function submit(): Promise<void> {
  if (!valid.value) return
  if (!props.entry && !form.name.trim() && !fetchedTitle.value) await fetchMetadata()
  let name = form.name.trim()
  if (!name && fetchedTitle.value) name = fetchedTitle.value
  if (!name) { try { name = new URL(form.url).hostname.replace(/^www\./i, '') } catch { name = form.url.trim() } }
  emit('save', { id: props.entry?.id, name, url: form.url.trim(), description: form.description.trim() || undefined, favicon: favicon.value, folderIds: folderIds.value })
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('cancel')">
    <form class="editor-dialog" @submit.prevent="submit">
      <div class="dialog-heading"><div><p class="eyebrow">{{ entry ? '编辑入口' : '添加到你的空间' }}</p><h2>{{ entry ? '编辑网址' : '添加网址' }}</h2></div><button type="button" class="icon-button" aria-label="关闭" @click="emit('cancel')">×</button></div>
      <label class="field-label">网址<input v-model="form.url" autofocus inputmode="url" placeholder="https://example.com" @blur="fetchMetadata" /></label>
      <label class="field-label">显示名称<input v-model="form.name" placeholder="输入网址后自动读取网页标题" /></label>
      <label class="field-label">备注（可选）<input v-model="form.description" placeholder="帮助你记起它的用途" /></label>
      <fieldset v-if="folders.length" class="folder-choice"><legend>收藏夹</legend><label v-for="folder in folders" :key="folder.id"><input v-model="folderIds" type="checkbox" :value="folder.id" />{{ folder.name }}</label></fieldset>
      <p v-if="metadataLoading || metadataMessage" class="metadata-status">{{ metadataLoading ? '正在读取网站标题和图标…' : metadataMessage }}</p>
      <div class="dialog-actions"><button type="button" class="secondary-button" :disabled="saving" @click="emit('cancel')">取消</button><button type="submit" class="primary-button" :disabled="!valid || saving">{{ saving ? '正在保存…' : '保存' }}</button></div>
    </form>
  </div>
</template>
