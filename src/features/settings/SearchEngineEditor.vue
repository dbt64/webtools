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
  saving.value = true
  error.value = ''
  const result = await window.desktop.updateSettings({ searchEngines: next, defaultSearchEngineId: defaultId })
  saving.value = false
  if (!result.ok) { error.value = result.error.message; return }
  emit('saved', result.data)
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
      <button v-if="engine.enabled" class="engine-default" :class="{ selected: settings.defaultSearchEngineId === engine.id }" @click="setDefault(engine.id)">{{ settings.defaultSearchEngineId === engine.id ? '默认' : '设为默认' }}<Check v-if="settings.defaultSearchEngineId === engine.id" :size="12" /></button>
      <span v-else class="engine-disabled-label">已停用</span>
      <div class="engine-actions">
        <button class="icon-button" :disabled="index === 0 || saving" aria-label="上移" @click="move(index, -1)"><ChevronUp :size="15" /></button>
        <button class="icon-button" :disabled="index === engines.length - 1 || saving" aria-label="下移" @click="move(index, 1)"><ChevronDown :size="15" /></button>
        <button class="icon-button" :aria-label="engine.enabled ? '停用搜索引擎' : '启用搜索引擎'" @click="toggle(engine)"><Eye v-if="engine.enabled" :size="14" /><EyeOff v-else :size="14" /></button>
        <button v-if="!engine.builtIn" class="icon-button" aria-label="编辑搜索引擎" @click="openEditor(engine)"><Pencil :size="14" /></button>
        <button v-if="!engine.builtIn" class="icon-button danger" aria-label="删除搜索引擎" @click="remove(engine)"><Trash2 :size="14" /></button>
      </div>
    </article>
    <button class="secondary-button engine-add" @click="openEditor()"><Plus :size="15" /> 添加自定义搜索引擎</button>
    <p v-if="error" class="inline-error">{{ error }}</p>
    <div v-if="editing" class="dialog-backdrop" @click.self="editing = false">
      <form class="editor-dialog" @submit.prevent="saveEditor">
        <div class="dialog-heading"><div><p class="eyebrow">搜索方式</p><h2>{{ editingId ? '编辑' : '添加' }}搜索引擎</h2></div><button type="button" class="icon-button" @click="editing = false">×</button></div>
        <label class="field-label">名称<input v-model="name" autofocus placeholder="例如：DuckDuckGo" /></label>
        <label class="field-label">搜索网址<small>使用 %s 代替搜索词，例如 https://example.com/search?q=%s</small><input v-model="template" placeholder="https://example.com/search?q=%s" /></label>
        <div class="dialog-actions"><button type="button" class="secondary-button" @click="editing = false">取消</button><button class="primary-button" :disabled="saving">保存</button></div>
      </form>
    </div>
  </section>
</template>
