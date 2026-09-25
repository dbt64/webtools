<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowUpRight, Globe, Pencil, Plus, Trash2, Wrench } from '@lucide/vue'
import type { ToolEntry, WebEntry } from '@/shared/domain'
import EntryEditor from './EntryEditor.vue'

const section = ref<'website' | 'tool'>('website')
const webEntries = ref<WebEntry[]>([])
const tools = ref<ToolEntry[]>([])
const editing = ref(false)
const current = ref<WebEntry | ToolEntry>()
const errorMessage = ref('')
const items = computed(() => section.value === 'website' ? webEntries.value : tools.value)

async function refresh(): Promise<void> {
  const result = await window.desktop.getEntries()
  webEntries.value = result.webEntries
  tools.value = result.tools
}

async function save(value: { id?: string; name: string; url?: string; command?: string; description?: string }): Promise<void> {
  const result = section.value === 'website'
    ? await window.desktop.saveWebEntry({ id: value.id, name: value.name, url: value.url ?? '', description: value.description })
    : await window.desktop.saveToolEntry({ id: value.id, name: value.name, command: value.command ?? '', description: value.description })
  if (!result.ok) {
    errorMessage.value = result.error.message
    return
  }
  editing.value = false
  current.value = undefined
  errorMessage.value = ''
  await refresh()
}

function edit(entry?: WebEntry | ToolEntry): void {
  current.value = entry
  editing.value = true
}

async function remove(entry: WebEntry | ToolEntry): Promise<void> {
  if (!window.confirm(`确定删除“${entry.name}”吗？`)) return
  const result = section.value === 'website'
    ? await window.desktop.deleteWebEntry(entry.id)
    : await window.desktop.deleteToolEntry(entry.id)
  if (!result.ok) errorMessage.value = result.error.message
  else await refresh()
}

async function open(entry: WebEntry | ToolEntry): Promise<void> {
  const result = section.value === 'website'
    ? await window.desktop.openWebEntry(entry.id)
    : await window.desktop.openToolEntry(entry.id)
  if (!result.ok) errorMessage.value = result.error.message
}

onMounted(() => { void refresh() })
</script>

<template>
  <section class="content-page">
    <div class="page-heading">
      <div><p class="eyebrow">收好常用入口</p><h1>网址与工具</h1><p class="page-description">添加常访问的网站，或记录需要快速打开的桌面工具。</p></div>
      <button class="primary-button" @click="edit()"><Plus :size="16" /> 添加{{ section === 'website' ? '网址' : '工具' }}</button>
    </div>

    <div class="segmented-tabs" role="tablist">
      <button :class="{ selected: section === 'website' }" @click="section = 'website'"><Globe :size="15" /> 网址 <span>{{ webEntries.length }}</span></button>
      <button :class="{ selected: section === 'tool' }" @click="section = 'tool'"><Wrench :size="15" /> 工具 <span>{{ tools.length }}</span></button>
    </div>

    <p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
    <div v-if="items.length" class="entry-list">
      <article v-for="entry in items" :key="entry.id" class="entry-row">
        <div class="entry-row-icon"><Globe v-if="section === 'website'" :size="18" /><Wrench v-else :size="18" /></div>
        <div class="entry-row-copy"><strong>{{ entry.name }}</strong><small>{{ 'url' in entry ? entry.url : entry.command }}</small><span v-if="entry.description">{{ entry.description }}</span></div>
        <div class="entry-actions">
          <button class="icon-button" :aria-label="`打开${entry.name}`" @click="open(entry)"><ArrowUpRight :size="15" /></button>
          <button class="icon-button" :aria-label="`编辑${entry.name}`" @click="edit(entry)"><Pencil :size="15" /></button>
          <button class="icon-button danger" :aria-label="`删除${entry.name}`" @click="remove(entry)"><Trash2 :size="15" /></button>
        </div>
      </article>
    </div>
    <div v-else class="empty-panel"><span class="empty-orb"><Globe v-if="section === 'website'" :size="18" /><Wrench v-else :size="18" /></span><strong>这里还没有{{ section === 'website' ? '网址' : '工具' }}</strong><span>添加一个，你就能从搜索框直接打开它。</span><button class="text-button" @click="edit()"><Plus :size="14" /> 现在添加</button></div>

    <EntryEditor v-if="editing" :kind="section" :entry="current" @save="save" @cancel="editing = false" />
  </section>
</template>
