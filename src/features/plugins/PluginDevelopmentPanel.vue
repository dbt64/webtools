<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginDevelopmentStatus } from '../../shared/plugin-development-contracts.ts'

const status = ref<PluginDevelopmentStatus>({ enabled: false, connected: false, diagnostics: [] })
const busy = ref(false)
const feedback = ref('')
let removeListener: (() => void) | undefined
let disposed = false

async function load(): Promise<void> {
  const result = await window.desktop.pluginDevelopment.get()
  if (!disposed && result.ok) status.value = result.data
}
async function perform(action: () => Promise<{ ok: boolean; error?: { message: string } }>): Promise<void> {
  busy.value = true; feedback.value = ''
  try {
    const result = await action()
    if (!result.ok) feedback.value = result.error?.message ?? '开发操作未完成。'
    if (!disposed) await load()
  } catch { if (!disposed) feedback.value = '开发连接不可用，请重新打开 Manager。' }
  finally { if (!disposed) busy.value = false }
}
function toggle(event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked
  void perform(() => window.desktop.pluginDevelopment.setEnabled(enabled))
}
function connectProject(): void { void perform(() => window.desktop.pluginDevelopment.connectFromDialog()) }
function disconnectProject(): void { void perform(() => window.desktop.pluginDevelopment.disconnect()) }
function openFeature(featureId: string): void { void perform(() => window.desktop.pluginDevelopment.openFeature(featureId)) }
async function copy(pluginId: string, featureId?: string): Promise<void> {
  await perform(() => window.desktop.pluginDevelopment.copyDiagnostics(pluginId, featureId))
  if (!disposed && !feedback.value) feedback.value = '诊断已复制。'
}
onMounted(() => {
  removeListener = window.desktop.pluginDevelopment.onChanged(value => { if (!disposed) status.value = value })
  void load().catch(() => { if (!disposed) feedback.value = '无法读取开发者状态。' })
})
onBeforeUnmount(() => { disposed = true; removeListener?.() })
</script>

<template>
  <section class="plugin-development-panel" aria-label="插件开发">
    <label class="developer-toggle"><input type="checkbox" :checked="status.enabled" :disabled="busy" @change="toggle" /><strong>开发者模式</strong><small>仅在当前 Electron Host 会话启用</small></label>
    <template v-if="status.enabled">
      <p class="developer-help">在外部项目运行 pnpm dev，然后连接项目。成功构建会重建正在运行的 Feature；开发数据与已安装插件隔离。</p>
      <div class="developer-actions">
        <button type="button" class="secondary-button" :disabled="busy" @click="connectProject">{{ status.project ? '连接其他开发项目…' : '连接开发项目…' }}</button>
        <button v-if="status.project" type="button" class="secondary-button" :disabled="busy" @click="disconnectProject">断开</button>
      </div>
      <div v-if="status.project" class="developer-project">
        <strong>{{ status.project.name }}</strong><code>{{ status.project.pluginId }}</code>
        <small>{{ status.project.projectName }} · {{ status.connected ? `已连接 · 构建 ${status.project.revision}` : '已断开，请重新连接' }}</small>
        <div class="developer-actions"><button v-for="feature in status.project.features" :key="feature.id" class="secondary-button" type="button" :disabled="busy || !status.connected || feature.available === false" @click="openFeature(feature.id)">{{ feature.title }}</button></div>
      </div>
      <article v-for="diagnostic in status.diagnostics" :key="`${diagnostic.pluginId}:${diagnostic.featureId ?? ''}`" class="developer-diagnostic">
        <div class="diagnostic-heading"><strong>Plugin Runtime Error</strong><button type="button" class="secondary-button" :disabled="busy" @click="copy(diagnostic.pluginId, diagnostic.featureId)">Copy Diagnostics</button></div>
        <dl><div><dt>Plugin</dt><dd>{{ diagnostic.pluginId }}</dd></div><div><dt>Feature</dt><dd>{{ diagnostic.featureId || '—' }}</dd></div><div><dt>Phase / Code</dt><dd>{{ diagnostic.phase }} / {{ diagnostic.code }}</dd></div><div><dt>Source</dt><dd>{{ diagnostic.source || '—' }}</dd></div></dl>
        <pre>{{ diagnostic.message }}</pre><details v-if="diagnostic.stack"><summary>Stack</summary><pre>{{ diagnostic.stack }}</pre></details>
        <small>{{ new Date(diagnostic.timestamp).toLocaleString() }}</small>
      </article>
    </template>
    <p v-if="feedback" role="status" class="developer-help">{{ feedback }}</p>
  </section>
</template>

<style scoped>
.plugin-development-panel { margin: 0 0 22px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; }
.developer-toggle, .developer-actions, .diagnostic-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.developer-toggle input { accent-color: var(--accent); }
.developer-toggle strong, .developer-project strong, .diagnostic-heading strong { font-size: 12px; }
.developer-toggle small, .developer-help, .developer-project small, .developer-diagnostic small { color: var(--muted); font-size: 10px; line-height: 1.6; }
.developer-project { display: grid; gap: 8px; margin-top: 12px; }
.developer-project code { overflow-wrap: anywhere; font-size: 11px; }
.developer-diagnostic { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
.diagnostic-heading { justify-content: space-between; }
dl { display: grid; gap: 6px; font-size: 11px; } dl > div { display: flex; flex-wrap: wrap; gap: 10px; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
pre { max-height: 230px; overflow: auto; padding: 10px; background: var(--surface); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; border-radius: 6px; }
summary { cursor: pointer; font-size: 11px; }
</style>
