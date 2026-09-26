<script setup lang="ts">
import { ref, watch } from 'vue'
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, Pencil, Plus, Search, Trash2 } from '@lucide/vue'
import type { AppSettings, SearchEngine } from '@/shared/domain'

const props = defineProps<{ settings: AppSettings }>()
const emit = defineEmits<{ saved: [settings: AppSettings] }>()
const engines = ref<SearchEngine[]>([])
const saving = ref(false)
const error = ref('')
const editing = ref(false)
const editingId = ref<string>()
const name = ref('')
const template = ref('')

watch(() => props.settings.searchEngines, (value) => { engines.value = value.map((engine) => ({ ...engine })).sort((a, b) => a.order - b.order) }, { immediate: true, deep: true })

async function persist(next: SearchEngine[], defaultId = props.settings.defaultSearchEngineId): Promise<void> {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const result = await window.desktop.updateSettings({ searchEngines: next, defaultSearchEngineId: defaultId })
    if (!result.ok) { error.value = result.error.message; return }
    emit('saved', result.data)
  } catch {
    error.value = '无法保存网页搜索设置，请检查本机数据后重试。'
  } finally { saving.value = false }
}

function openEditor(engine?: SearchEngine): void {
  editingId.value = engine?.id
  name.value = engine?.name ?? ''
  template.value = engine?.template ?? ''
  editing.value = true
}

async function saveEditor(): Promise<void> {
  const label = name.value.trim()
  const url = template.value.trim()
  if (!label || (url.match(/%s/g) ?? []).length !== 1) { error.value = '名称不能为空，搜索网址必须且只能包含一个 %s。'; return }
  const item: SearchEngine = { id: editingId.value ?? `custom-${crypto.randomUUID()}`, name: label, template: url, builtIn: false, enabled: true, order: editingId.value ? (engines.value.find((x) => x.id === editingId.value)?.order ?? engines.value.length) : engines.value.length }
  const next = editingId.value ? engines.value.map((x) => x.id === editingId.value ? item : x) : [...engines.value, item]
  await persist(next)
  if (!error.value) editing.value = false
}

async function setDefault(id: string): Promise<void> { await persist(engines.value, id) }

async function toggle(engine: SearchEngine): Promise<void> {
  const next = engines.value.map((item) => item.id === engine.id ? { ...item, enabled: !item.enabled } : item)
  const nextDefault = engine.id === props.settings.defaultSearchEngineId && engine.enabled ? next.find((item) => item.enabled)?.id ?? engine.id : props.settings.defaultSearchEngineId
  await persist(next, nextDefault)
}

async function move(index: number, delta: number): Promise<void> {
  const next = [...engines.value]
  const target = index + delta
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target], next[index]]
  await persist(next.map((engine, order) => ({ ...engine, order })))
}

async function remove(engine: SearchEngine): Promise<void> {
  if (engine.builtIn) return
  const next = engines.value.filter((item) => item.id !== engine.id).map((item, order) => ({ ...item, order }))
  const nextDefault = props.settings.defaultSearchEngineId === engine.id ? next.find((item) => item.enabled)?.id ?? 'google' : props.settings.defaultSearchEngineId
  await persist(next, nextDefault)
}
</script>

<template>
  <section class="settings-group search-engine-group">
    <div class="settings-group-heading"><span class="settings-group-icon"><Search :size="17" /></span><div><strong>网页搜索</strong><p>输入 ?关键词 时，使用默认引擎在浏览器中打开</p></div></div>
    <article v-for="(engine, index) in engines" :key="engine.id" class="engine-row" :class="{ disabled: !engine.enabled }">
      <span class="engine-logo">{{ [...engine.name][0]?.toLocaleUpperCase() ?? '?' }}</span>
      <span class="engine-copy"><strong>{{ engine.name }}<small v-if="engine.builtIn">内置</small></strong><code>{{ engine.template }}</code></span>
      <button v-if="engine.enabled" class="engine-default" :class="{ selected: settings.defaultSearchEngineId === engine.id }" :disabled="saving" @click="setDefault(engine.id)">{{ settings.defaultSearchEngineId === engine.id ? '默认' : '设为默认' }}<Check v-if="settings.defaultSearchEngineId === engine.id" :size="12" /></button>
      <span v-else class="engine-disabled-label">已停用</span>
      <div class="engine-actions">
        <button class="icon-button" :disabled="index === 0 || saving" aria-label="上移" @click="move(index, -1)"><ChevronUp :size="15" /></button>
        <button class="icon-button" :disabled="index === engines.length - 1 || saving" aria-label="下移" @click="move(index, 1)"><ChevronDown :size="15" /></button>
        <button class="icon-button" :disabled="saving" :aria-label="engine.enabled ? '停用搜索引擎' : '启用搜索引擎'" @click="toggle(engine)"><Eye v-if="engine.enabled" :size="14" /><EyeOff 