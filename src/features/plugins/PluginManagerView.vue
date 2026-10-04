<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, CircleAlert, CircleCheck, ExternalLink, Languages, PackagePlus, Puzzle, RefreshCw, ShieldCheck, Trash2, ToggleLeft, ToggleRight } from '@lucide/vue'
import type { PluginCapability, PluginSummary } from '../../shared/plugin-contracts.ts'
import type { BuiltinEntryDTO, CatalogEntryDTO, PluginRef } from '../../shared/plugin-catalog-contracts.ts'
import { catalogKey, catalogRef, catalogPresentation } from './catalog-view-model.ts'
import { pluginGrantPayload, pluginInstallFeedback, pluginPermissionRows, pluginStatusView } from './plugin-view-model.ts'

const props = defineProps<{ entries: CatalogEntryDTO[]; loading: boolean; error?: string }>()
const emit = defineEmits<{ changed: []; retry: []; openPlugin: [ref: PluginRef] }>()

const selectedRef = ref<PluginRef | null>(null)
const selected = computed(() => props.entries.find(entry => selectedRef.value && catalogKey(entry) === catalogKey(selectedRef.value)) ?? props.entries[0] ?? null)
const selectedPackage = computed(() => selected.value?.kind === 'declarative' ? selected.value.package : null)
const selectedBuiltin = computed(() => selected.value?.kind === 'builtin' ? selected.value : null)
const grantedDraft = ref<PluginCapability[]>([])
const busy = ref<string | null>(null)
const feedback = ref<{ kind: 'status' | 'error'; text: string } | null>(null)
const permissionRows = computed(() => selectedPackage.value ? pluginPermissionRows(selectedPackage.value) : [])

watch(selected, plugin => {
  selectedRef.value = plugin ? catalogRef(plugin) : null
  grantedDraft.value = plugin?.kind === 'declarative' ? plugin.package.granted.slice() : []
}, { immediate: true })

function errorText(error: { code: string; message: string }): string {
  const recovery: Record<string, string> = {
    INVALID_PACKAGE: '请重新选择完整的 .wtplugin 安装包。',
    INVALID_MANIFEST: '检查插件清单后重新导入。',
    INCOMPATIBLE_PLUGIN: '请安装支持当前 WebTools 版本的插件。',
    INTEGRITY_FAILED: '插件文件校验失败；请重新导入原始安装包。',
    PERMISSION_DENIED: '检查插件申请的权限后重试。',
    CONFIG_INCOMPATIBLE: '已保留当前版本和配置；请安装兼容版本。',
    USER_CONFIRMATION_REQUIRED: '此操作的确认已失效或未完成，请重新发起操作并完成宿主确认。',
    AI_NOT_CONFIGURED: '前往 WebTools AI 设置完成提供方配置。',
    AI_TIMEOUT: '检查网络连接后重试。',
    OPERATION_FAILED: '请重试；如果问题持续，请先停用插件。',
    STATE_INVALID: '状态文件未被覆盖；可以备份原文件后恢复。',
    STATE_UNSUPPORTED: '状态文件版本不兼容；原文件已保留。',
    STATE_UNAVAILABLE: '当前无法安全读取状态，请检查权限或执行受控恢复。',
    STATE_WRITE_FAILED: '本次状态没有保存；翻译仍保持停用，请重试。',
    STATE_RECOVERY_FAILED: '恢复没有完成，原状态文件仍然保留。',
  }
  return `${error.message}${recovery[error.code] ? ` ${recovery[error.code]}` : ''}`
}

async function perform(key: string, operation: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = key
  feedback.value = null
  try { await operation() }
  catch { feedback.value = { kind: 'error', text: '插件操作没有完成，请重试。' } }
  finally { busy.value = null; emit('changed') }
}

async function install(): Promise<void> {
  await perform('install', async () => {
    const result = await window.desktop.plugins.installFromUserDialog()
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    feedback.value = { kind: 'status', text: pluginInstallFeedback(result.data) }
  })
}

async function toggle(plugin: PluginSummary): Promise<void> {
  await perform(`toggle:${plugin.id}`, async () => {
    const result = await window.desktop.pluginCatalog.setEnabled({ kind: 'declarative', id: plugin.id }, !plugin.enabled)
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    if (result.data.kind !== 'declarative') { feedback.value = { kind: 'error', text: '插件状态响应无效，请重新加载。' }; return }
    feedback.value = result.data.package.enabled
      ? { kind: 'status', text: '插件已启用。' }
      : { kind: 'status', text: plugin.enabled ? '插件已停用；设置和私有数据已保留。' : '权限确认已取消，插件仍保持停用。' }
  })
}

async function toggleBuiltin(plugin: BuiltinEntryDTO): Promise<void> {
  if (!plugin.management.canToggle) return
  const enabled = plugin.state.status === 'faulted' ? plugin.state.retryEnabled : !plugin.state.enabled
  await perform('builtin-state', async () => {
    const result = await window.desktop.pluginCatalog.setEnabled(catalogRef(plugin), enabled)
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    feedback.value = { kind: 'status', text: enabled ? '翻译已启用。' : '翻译已停用；翻译设置和 AI 密钥已保留。' }
  })
}

async function recoverBuiltin(): Promise<void> {
  await perform('builtin-recovery', async () => {
    const result = await window.desktop.pluginCatalog.recoverBuiltinTranslation()
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    feedback.value = result.data.recovered
      ? { kind: 'status', text: '原状态文件已备份，翻译状态已恢复为启用。' }
      : { kind: 'status', text: '已取消恢复。' }
  })
}

function toggleDraft(capability: PluginCapability, checked: boolean): void {
  const current = new Set(grantedDraft.value)
  if (checked) current.add(capability); else current.delete(capability)
  grantedDraft.value = [...current]
}

async function savePermissions(): Promise<void> {
  const plugin = selectedPackage.value
  if (!plugin) return
  await perform(`grants:${plugin.id}`, async () => {
    const result = await window.desktop.plugins.setGrants(plugin.id, pluginGrantPayload(grantedDraft.value))
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    grantedDraft.value = result.data.granted.slice()
    feedback.value = { kind: 'status', text: '权限状态已更新。新授予的能力由 WebTools 宿主确认。' }
  })
}

async function uninstall(): Promise<void> {
  const plugin = selectedPackage.value
  if (!plugin) return
  await perform(`uninstall:${plugin.id}`, async () => {
    const result = await window.desktop.plugins.uninstall(plugin.id)
    if (!result.ok) { feedback.value = { kind: 'error', text: errorText(result.error) }; return }
    feedback.value = result.data.removed
      ? { kind: 'status', text: '插件已卸载；数据是否删除由 WebTools 宿主中的单独选择决定。' }
      : { kind: 'status', text: '卸载已取消。' }
  })
}

function select(plugin: CatalogEntryDTO): void {
  selectedRef.value = catalogRef(plugin)
  grantedDraft.value = plugin.kind === 'declarative' ? plugin.package.granted.slice() : []
  feedback.value = null
}
</script>

<template>
  <section class="content-page plugin-manager-page">
    <header class="page-heading plugin-manager-heading">
      <div><p class="eyebrow">应用扩展</p><h1>插件管理</h1><p class="page-description">查看随 WebTools 提供的内置插件，管理本机导入的声明式插件及其权限。</p></div>
      <button class="primary-button" :disabled="loading || Boolean(busy)" @click="install"><PackagePlus :size="15" />{{ busy === 'install' ? '正在安装…' : '安装本地插件' }}</button>
    </header>

    <p v-if="feedback" class="plugin-feedback" :class="`is-${feedback.kind}`" :role="feedback.kind === 'error' ? 'alert' : 'status'" aria-live="polite">
      <CircleAlert v-if="feedback.kind === 'error'" :size="15" /><CircleCheck v-else :size="15" />{{ feedback.text }}
    </p>

    <div v-if="loading" class="plugin-empty-state" role="status" aria-live="polite"><RefreshCw :size="17" class="plugin-spin" />正在读取已安装的插件…</div>
    <div v-if="error" class="plugin-empty-state plugin-empty-error" role="alert"><CircleAlert :size="17" /><span>{{ error }}</span><button class="secondary-button" @click="emit('retry')">重新加载</button></div>
    <div v-if="!loading && !error && entries.length === 0" class="plugin-empty-state"><Puzzle :size="21" /><div><strong>尚未安装插件</strong><p>选择本机的 .wtplugin 文件开始使用。新插件会先保持停用。</p></div><button class="secondary-button" @click="install">安装本地插件</button></div>

    <div v-if="entries.length > 0" class="plugin-manager-layout">
      <nav class="plugin-list" aria-label="已安装插件">
        <button v-for="plugin in entries" :key="catalogKey(plugin)" type="button" class="plugin-list-row" :disabled="Boolean(busy)" :class="{ selected: selected && catalogKey(selected) === catalogKey(plugin) }" :aria-current="selected && catalogKey(selected) === catalogKey(plugin) ? 'true' : undefined" @click="select(plugin)">
          <span class="plugin-row-icon" aria-hidden="true"><Languages v-if="plugin.icon.kind === 'host'" :size="18" /><img v-else-if="plugin.icon.kind === 'png'" :src="plugin.icon.dataUrl" alt="" /><Puzzle v-else :size="18" /></span>
          <span class="plugin-row-copy"><strong :title="catalogPresentation(plugin).name">{{ catalogPresentation(plugin).name }}</strong><small>{{ catalogPresentation(plugin).author }} · {{ catalogPresentation(plugin).version }}</small></span>
          <span class="plugin-state" :class="'tone-' + catalogPresentation(plugin).status.tone">{{ catalogPresentation(plugin).status.label }}</span>
        </button>
      </nav>

      <section v-if="selectedBuiltin" class="plugin-detail plugin-builtin-detail" aria-labelledby="plugin-detail-title">
        <div class="plugin-detail-heading"><div class="plugin-row-icon plugin-detail-icon" aria-hidden="true"><Languages :size="19" /></div><div class="plugin-detail-title"><h2 id="plugin-detail-title">{{ selectedBuiltin.name }}</h2><p>{{ selectedBuiltin.description }}</p></div><span class="plugin-state" :class="`tone-${catalogPresentation(selectedBuiltin).status.tone}`">{{ catalogPresentation(selectedBuiltin).status.label }}</span></div>
        <dl class="plugin-facts"><div><dt>插件 ID</dt><dd>{{ selectedBuiltin.id }}</dd></div><div><dt>版本</dt><dd>{{ selectedBuiltin.version }}</dd></div><div><dt>来源</dt><dd>随 WebTools 发布</dd></div><div><dt>状态</dt><dd>{{ catalogPresentation(selectedBuiltin).status.label }}</dd></div></dl>
        <div v-if="selectedBuiltin.state.status === 'faulted' || selectedBuiltin.state.status === 'unavailable'" class="plugin-error-detail" role="alert"><CircleAlert :size="15" /><span><strong>{{ selectedBuiltin.state.errorCode }}</strong><small>{{ selectedBuiltin.state.status === 'unavailable' ? '翻译已关闭。恢复前会备份当前状态文件，不会清理其他插件或配置。' : '状态写入没有完成；当前会话已关闭翻译请求。可重试上次操作。' }}</small></span></div>
        <p class="plugin-data-note"><Check :size="13" />停用翻译会保留全局翻译设置、AI 提供方配置、密钥和第三方插件状态；Shared AI 仍供其他功能使用。</p>
        <div class="plugin-actions">
          <button v-if="selectedBuiltin.management.canToggle" :class="selectedBuiltin.state.status === 'disabled' || (selectedBuiltin.state.status === 'faulted' && selectedBuiltin.state.retryEnabled) ? 'primary-button' : 'secondary-button'" :disabled="Boolean(busy)" @click="toggleBuiltin(selectedBuiltin)"><ToggleRight v-if="selectedBuiltin.state.status === 'disabled' || (selectedBuiltin.state.status === 'faulted' && selectedBuiltin.state.retryEnabled)" :size="15" /><ToggleLeft v-else :size="15" />{{ busy === 'builtin-state' ? '正在保存…' : selectedBuiltin.state.status === 'faulted' ? (selectedBuiltin.state.retryEnabled ? '重试启用' : '重试停用') : selectedBuiltin.state.enabled ? '停用翻译' : '启用翻译' }}</button>
          <button v-if="selectedBuiltin.management.canRecover" class="primary-button" :disabled="Boolean(busy)" @click="recoverBuiltin"><RefreshCw :size="14" />{{ busy === 'builtin-recovery' ? '正在恢复…' : '备份并恢复状态' }}</button>
          <button v-if="selectedBuiltin.state.status === 'ready' && selectedBuiltin.state.enabled" class="secondary-button" :disabled="Boolean(busy)" @click="emit('openPlugin', catalogRef(selectedBuiltin))"><ExternalLink :size="14" />打开翻译</button>
        </div>
      </section>
      <section v-else-if="selectedPackage" class="plugin-detail" aria-labelledby="plugin-detail-title">
        <div class="plugin-detail-heading">
          <div class="plugin-row-icon plugin-detail-icon" aria-hidden="true"><img v-if="selectedPackage.iconDataUrl" :src="selectedPackage.iconDataUrl" alt="" /><Puzzle v-else :size="19" /></div>
          <div class="plugin-detail-title"><h2 id="plugin-detail-title">{{ selectedPackage.name }}</h2><p>{{ selectedPackage.description || '没有提供说明。' }}</p></div>
          <span class="plugin-state" :class="`tone-${pluginStatusView(selectedPackage).tone}`">{{ pluginStatusView(selectedPackage).label }}</span>
        </div>

        <div class="plugin-trust-note"><ShieldCheck :size="16" /><span><strong>本地插件，发布者未经验证</strong><small>SHA-256 仅用于识别已安装文件的完整性，不代表发布者身份或安全认证。</small></span></div>
        <dl class="plugin-facts">
          <div><dt>插件 ID</dt><dd>{{ selectedPackage.id }}</dd></div>
          <div><dt>作者</dt><dd>{{ selectedPackage.author?.name ?? '未知' }}<a v-if="selectedPackage.author?.url" :href="selectedPackage.author.url" target="_blank" rel="noreferrer" aria-label="打开作者网站"><ExternalLink :size="13" /></a></dd></div>
          <div><dt>宿主 API</dt><dd>{{ selectedPackage.api ? `API ${selectedPackage.api.apiMajor} · 需要 ${selectedPackage.api.minHostVersion} 或更新版本` : '信息不可用' }}</dd></div>
          <div><dt>版本</dt><dd>{{ selectedPackage.version }}<span v-if="selectedPackage.installedVersions.length > 1"> · 保留版本：{{ selectedPackage.installedVersions.join('、') }}</span></dd></div>
          <div class="plugin-hash-row"><dt>完整性摘要（SHA-256）</dt><dd><code>{{ selectedPackage.hash }}</code></dd></div>
        </dl>

        <div v-if="selectedPackage.errorCode" class="plugin-error-detail" role="alert"><CircleAlert :size="15" /><span><strong>{{ selectedPackage.errorCode }}</strong><small>{{ pluginStatusView(selectedPackage).recovery }}</small></span></div>

        <section class="plugin-permissions" aria-labelledby="plugin-permission-title">
          <div class="plugin-section-heading"><div><h3 id="plugin-permission-title">请求的能力</h3><p>新授予的能力需由 WebTools 宿主再次确认；未选中的能力会立即撤销。</p></div></div>
          <fieldset class="plugin-permission-list" :disabled="Boolean(busy)"><legend class="visually-hidden">管理 {{ selectedPackage.name }} 的权限</legend>
            <label v-for="permission in permissionRows" :key="permission.id" class="plugin-permission-row">
              <input type="checkbox" :checked="grantedDraft.includes(permission.id)" @change="toggleDraft(permission.id, ($event.target as HTMLInputElement).checked)" />
              <span>{{ permission.label }}</span><small>{{ permission.granted ? '已授予' : '尚未授予' }}</small>
            </label>
            <p v-if="permissionRows.length === 0" class="plugin-no-permissions">此插件未申请额外能力。</p>
          </fieldset>
          <button class="secondary-button" :disabled="Boolean(busy) || JSON.stringify(grantedDraft.slice().sort()) === JSON.stringify(selectedPackage.granted.slice().sort())" @click="savePermissions">{{ busy === `grants:${selectedPackage.id}` ? '保存中…' : '保存权限' }}</button>
        </section>

        <div class="plugin-actions">
          <button v-if="selectedPackage.enabled" class="secondary-button" :disabled="Boolean(busy)" @click="toggle(selectedPackage)"><ToggleLeft :size="15" />{{ busy === `toggle:${selectedPackage.id}` ? '正在停用…' : '停用插件' }}</button>
          <button v-else class="primary-button" :disabled="Boolean(busy) || selectedPackage.status === 'invalid' || selectedPackage.status === 'incompatible'" @click="toggle(selectedPackage)"><ToggleRight :size="15" />{{ busy === `toggle:${selectedPackage.id}` ? '正在启用…' : '启用插件' }}</button>
          <button v-if="selectedPackage.enabled && selectedPackage.granted.includes('manager.page') && selectedPackage.status === 'active'" class="secondary-button" :disabled="Boolean(busy)" @click="emit('openPlugin', { kind: 'declarative', id: selectedPackage.id })"><ExternalLink :size="14" />打开插件页面</button>
          <button class="secondary-button" :disabled="Boolean(busy)" @click="install"><RefreshCw :size="14" />导入替换或新版本</button>
          <button class="danger-button" :disabled="Boolean(busy)" @click="uninstall"><Trash2 :size="14" />卸载…</button>
        </div>
        <p class="plugin-data-note"><Check :size="13" />停用会保留设置和私有数据。卸载与数据删除由 WebTools 宿主分别确认，默认保留数据。</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.plugin-manager-page { width: min(1040px, 100%); max-width: 1040px; align-self: stretch; }
.plugin-manager-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.plugin-manager-heading .primary-button { flex: 0 0 auto; }
.plugin-manager-layout { display: grid; grid-template-columns: minmax(210px, .72fr) minmax(0, 1.5fr); align-items: start; gap: 26px; }
.plugin-list { display: grid; gap: 4px; }
.plugin-list-row { display: grid; width: 100%; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px; border: 0; border-radius: 8px; color: var(--text); background: transparent; text-align: left; cursor: pointer; }
.plugin-list-row:hover, .plugin-list-row.selected { background: var(--hover); }
.plugin-row-icon { display: grid; width: 34px; height: 34px; place-items: center; overflow: hidden; border-radius: 8px; color: var(--accent); background: var(--accent-soft); }
.plugin-row-icon img { width: 24px; height: 24px; object-fit: contain; }
.plugin-row-copy { display: grid; min-width: 0; gap: 3px; }
.plugin-row-copy strong, .plugin-row-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-row-copy strong { font-size: 11px; font-weight: 600; }
.plugin-row-copy small, .plugin-detail-title p, .plugin-section-heading p { color: var(--muted); font-size: 9px; line-height: 1.5; }
.plugin-state { display: inline-flex; align-items: center; padding: 4px 7px; border-radius: 99px; color: var(--muted); background: var(--surface-raised); font-size: 9px; white-space: nowrap; }
.tone-good { color: #79c89b; background: color-mix(in srgb, #429766 16%, var(--surface)); }
.tone-warning { color: #d4ad6e; background: color-mix(in srgb, #bc862e 15%, var(--surface)); }
.tone-danger { color: #e69b93; background: color-mix(in srgb, #a8483e 15%, var(--surface)); }
.tone-quiet { color: var(--muted); }
.plugin-detail { min-width: 0; padding: 0 0 18px; }
.plugin-detail-heading { display: flex; min-width: 0; align-items: center; gap: 12px; margin-bottom: 16px; }
.plugin-detail-icon { width: 42px; height: 42px; flex: 0 0 auto; }
.plugin-detail-icon img { width: 30px; height: 30px; }
.plugin-detail-title { min-width: 0; flex: 1; }
.plugin-detail-title h2 { overflow-wrap: anywhere; margin: 0; font-size: 18px; font-weight: 650; }
.plugin-detail-title p { overflow-wrap: anywhere; margin: 5px 0 0; }
.plugin-trust-note { display: flex; align-items: flex-start; gap: 9px; padding: 11px 12px; margin: 0 0 14px; border-radius: 8px; color: #d9bd8b; background: color-mix(in srgb, #896a36 15%, var(--surface)); }
.plugin-trust-note > span, .plugin-error-detail > span { display: grid; gap: 4px; }
.plugin-trust-note strong, .plugin-error-detail strong { font-size: 10px; font-weight: 600; }
.plugin-trust-note small, .plugin-error-detail small { color: var(--muted); font-size: 9px; line-height: 1.5; }
.plugin-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 18px; padding: 0; margin: 0 0 16px; }
.plugin-facts > div { min-width: 0; }
.plugin-facts dt { margin-bottom: 4px; color: var(--muted); font-size: 9px; }
.plugin-facts dd { display: flex; min-width: 0; align-items: center; gap: 5px; overflow-wrap: anywhere; margin: 0; color: var(--text); font-size: 10px; }
.plugin-facts a { display: inline-flex; color: var(--accent); }
.plugin-hash-row { grid-column: 1 / -1; }
.plugin-hash-row code { overflow-wrap: anywhere; color: var(--muted); font-family: inherit; font-size: 9px; }
.plugin-error-detail { display: flex; gap: 8px; padding: 10px; margin-bottom: 14px; border-radius: 7px; color: #e69b93; background: color-mix(in srgb, #a8483e 14%, var(--surface)); }
.plugin-permissions { display: grid; gap: 9px; padding-top: 15px; border-top: 1px solid var(--line); }
.plugin-section-heading h3 { margin: 0; font-size: 12px; font-weight: 600; }
.plugin-section-heading p { margin: 4px 0 0; }
.plugin-permission-list { display: grid; gap: 2px; padding: 0; margin: 0; border: 0; }
.plugin-permission-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 7px 4px; color: var(--text); font-size: 10px; }
.plugin-permission-row input { accent-color: var(--accent); }
.plugin-permission-row small { color: var(--muted); font-size: 9px; }
.plugin-permission-list:disabled { opacity: .58; }
.plugin-no-permissions { color: var(--muted); font-size: 10px; }
.plugin-actions { display: flex; flex-wrap: wrap; gap: 7px; padding-top: 17px; }
.plugin-actions :deep(.danger-button), .plugin-actions .danger-button { display: inline-flex; min-height: 34px; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid color-mix(in srgb, #b65a50 45%, var(--line)); border-radius: 8px; color: #e2a19a; background: transparent; font: inherit; font-size: 10px; cursor: pointer; }
.plugin-actions .danger-button:hover:not(:disabled) { background: color-mix(in srgb, #a8483e 13%, var(--surface)); }
.plugin-data-note { display: flex; align-items: flex-start; gap: 6px; color: var(--muted); font-size: 9px; line-height: 1.5; }
.plugin-feedback, .plugin-empty-state { display: flex; align-items: center; gap: 9px; padding: 12px; margin: 0 0 15px; border-radius: 8px; color: var(--muted); background: var(--surface); font-size: 10px; }
.plugin-feedback { color: #82cb9c; }
.plugin-feedback.is-error, .plugin-empty-error { color: #e69b93; }
.plugin-empty-state { min-height: 102px; }
.plugin-empty-state strong { color: var(--text); font-size: 12px; }
.plugin-empty-state p { margin: 5px 0 0; color: var(--muted); line-height: 1.5; }
.plugin-empty-state .secondary-button { margin-left: auto; flex: 0 0 auto; }
.plugin-spin { animation: plugin-spin 1.2s linear infinite; }
@keyframes plugin-spin { to { transform: rotate(360deg); } }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; clip-path: inset(50%); }
@media (max-width: 850px) { .plugin-manager-layout { grid-template-columns: 1fr; gap: 14px; } .plugin-list { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); } }
@media (max-width: 680px) { .plugin-manager-heading { align-items: flex-start; flex-direction: column; } .plugin-facts { grid-template-columns: 1fr; } .plugin-hash-row { grid-column: auto; } }
@media (prefers-reduced-motion: reduce) { .plugin-spin { animation: none; } }
</style>
