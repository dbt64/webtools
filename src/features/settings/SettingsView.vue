<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, FolderSearch, Keyboard, Puzzle, Settings2, Search, Mouse, Sparkles, Palette, Info } from '@lucide/vue'
import { createDefaultAppData, type AppSettings, type LauncherDisplayMode, type ThemePreference } from '@/shared/domain'
import { applyTheme } from '@/shared/theme'
import SearchEngineEditor from './SearchEngineEditor.vue'
import SuperPanelSettings from './SuperPanelSettings.vue'
import SharedAISettings from './SharedAISettings.vue'

const props = defineProps<{ superPanelFocusRequestId?: string; aiFocusRequestId?: string }>()
const emit = defineEmits<{ openPluginManagement: [] }>()

const settings = ref<AppSettings>(createDefaultAppData().settings)
const saved = ref(false)
const errorMessage = ref('')
const recordingShortcut = ref(false)
const savingShortcut = ref(false)
const pendingShortcut = ref<string | null>(null)
const shortcutMessage = ref('')
const savingTheme = ref(false)
const savingLauncherMode = ref(false)
const everythingStatus = ref<{ executablePath?: string; running: boolean; version?: string }>()
const checkingEverything = ref(false)
let isMounted = false
let everythingGeneration = 0

const shortcutPresets = [
  { value: 'Alt+Space', label: 'Alt + Space' },
  { value: 'Control+Space', label: 'Ctrl + Space' },
] as const
const doubleModifierPresets = [
  { value: 'DoubleModifier:Control', label: '双击 Ctrl' },
  { value: 'DoubleModifier:Alt', label: '双击 Alt' },
] as const
const functionKeyPresets = Array.from({ length: 10 }, (_, index) => {
  const number = index + 1
  return { value: `FunctionKey:F${number}`, label: `F${number}` }
})
const displayedShortcut = computed(() => formatShortcut(pendingShortcut.value ?? settings.value.quickSearchShortcut))

function formatShortcut(value: string): string {
  if (value === 'DoubleModifier:Control') return '双击 Ctrl'
  if (value === 'DoubleModifier:Alt') return '双击 Alt'
  if (value.startsWith('FunctionKey:')) return value.slice('FunctionKey:'.length)
  const modifierLabels: Record<string, string> = { Control: 'Ctrl', Super: 'Win' }
  return value.split('+').map((part) => modifierLabels[part] ?? part).join(' + ')
}

let savedTimer: number | undefined
function markSaved(): void {
  if (!isMounted) return
  saved.value = true
  if (savedTimer !== undefined) window.clearTimeout(savedTimer)
  savedTimer = window.setTimeout(() => { saved.value = false }, 1800)
}

function stageShortcut(shortcut: string): void {
  pendingShortcut.value = shortcut === settings.value.quickSearchShortcut ? null : shortcut
  recordingShortcut.value = false
  shortcutMessage.value = ''
}

function beginShortcutCapture(): void {
  recordingShortcut.value = true
  shortcutMessage.value = ''
}

function cancelPendingShortcut(): void {
  pendingShortcut.value = null
  recordingShortcut.value = false
  shortcutMessage.value = ''
}

async function applyPendingShortcut(): Promise<void> {
  if (!pendingShortcut.value || savingShortcut.value) return
  savingShortcut.value = true
  shortcutMessage.value = ''
  try {
    const result = await window.desktop.updateSettings({ quickSearchShortcut: pendingShortcut.value })
    if (!isMounted) return
    if (!result.ok) {
      shortcutMessage.value = '无法应用此快捷键，可能与 Windows 或其他应用冲突。当前快捷键保持不变。'
      return
    }
    settings.value = result.data
    pendingShortcut.value = null
    shortcutMessage.value = ''
    markSaved()
  } catch {
    shortcutMessage.value = '无法应用此快捷键，可能与 Windows 或其他应用冲突。当前快捷键保持不变。'
  } finally {
    savingShortcut.value = false
  }
}

function handleShortcutKeydown(event: KeyboardEvent): void {
  if (!recordingShortcut.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') { recordingShortcut.value = false; shortcutMessage.value = ''; return }
  if (event.repeat) return
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
  const modifiers = [event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Super' : ''].filter(Boolean)
  if (!modifiers.length) return
  const names: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', PageUp: 'PageUp', PageDown: 'PageDown' }
  const key = names[event.key] ?? (/^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : event.key)
  if (!/^[A-Z0-9]$/.test(key) && !/^F(?:[1-9]|1[0-2])$/.test(key) && !['Space', 'Up', 'Down', 'Left', 'Right', 'PageUp', 'PageDown', 'Home', 'End', 'Insert', 'Delete', 'Backspace', 'Tab', 'Enter'].includes(key)) {
    shortcutMessage.value = '该组合键不受支持。请使用 Ctrl、Alt、Shift 或 Win 加字母、数字、方向键等按键。'
    return
  }
  stageShortcut([...modifiers, key].join('+'))
}

async function toggleStartup(): Promise<void> {
  if (savingStartup.value) return
  savingStartup.value = true
  try {
    const result = await window.desktop.updateSettings({ launchOnStartup: !settings.value.launchOnStartup })
    if (!isMounted) return
    if (!result.ok) errorMessage.value = '无法更新开机启动，请检查 NativeHost 连接后重试。'
    else { settings.value = result.data; errorMessage.value = ''; markSaved() }
  } catch { if (isMounted) errorMessage.value = '无法更新开机启动，请重试。' }
  finally { if (isMounted) savingStartup.value = false }
}

function handleEnginesSaved(value: AppSettings): void { if (isMounted) { settings.value = value; markSaved() } }

async function saveTheme(theme: ThemePreference): Promise<void> {
  if (savingTheme.value || theme === settings.value.theme) return
  savingTheme.value = true
  try {
    const result = await window.desktop.updateSettings({ theme })
    if (!isMounted) return
    if (!result.ok) { errorMessage.value = result.error.message; return }
    settings.value = result.data
    applyTheme(result.data.theme)
    errorMessage.value = ''
    markSaved()
  } catch {
    errorMessage.value = '无法保存主题设置，请重试。'
  } finally {
    savingTheme.value = false
  }
}

async function saveLauncherMode(launcherDisplayMode: LauncherDisplayMode): Promise<void> {
  if (savingLauncherMode.value || launcherDisplayMode === settings.value.launcherDisplayMode) return
  savingLauncherMode.value = true
  try {
    const result = await window.desktop.updateSettings({ launcherDisplayMode })
    if (!isMounted) return
    if (!result.ok) { errorMessage.value = result.error.message; return }
    settings.value = result.data
    errorMessage.value = ''
    markSaved()
  } catch {
    errorMessage.value = '无法保存搜索框模式，请重试。'
  } finally {
    savingLauncherMode.value = false
  }
}

async function refreshEverything(): Promise<void> {
  const request = ++everythingGeneration
  checkingEverything.value = true
  try {
    const status = await window.desktop.detectEverything()
    if (!isMounted || request !== everythingGeneration) return
    everythingStatus.value = status
  } catch { if (isMounted && request === everythingGeneration) errorMessage.value = '无法检测 Everything，请检查安装和运行状态。' }
  finally { if (isMounted && request === everythingGeneration) checkingEverything.value = false }
}

async function toggleEverything(): Promise<void> {
  try {
    const result = await window.desktop.updateSettings({ everythingEnabled: !settings.value.everythingEnabled })
    if (!isMounted) return
    if (!result.ok) errorMessage.value = result.error.message
    else { settings.value = result.data; errorMessage.value = ''; markSaved(); if (settings.value.everythingEnabled) void refreshEverything() }
  } catch { if (isMounted) errorMessage.value = '无法保存文件搜索设置，请重试。' }
}

async function browseEverything(): Promise<void> {
  try {
    const path = await window.desktop.chooseEverythingPath()
    if (!isMounted || !path) return
    const result = await window.desktop.updateSettings({ everythingEsPath: path })
    if (!isMounted) return
    if (!result.ok) { errorMessage.value = result.error.message; return }
    settings.value = result.data
    errorMessage.value = ''
    markSaved()
    await refreshEverything()
  } catch { if (isMounted) errorMessage.value = '无法保存 ES 路径，请重试。' }
}

async function autoDetectEverything(): Promise<void> {
  await refreshEverything()
  if (isMounted && everythingStatus.value?.executablePath && !settings.value.everythingEsPath) {
    try {
      const result = await window.desktop.updateSettings({ everythingEsPath: everythingStatus.value.executablePath })
      if (!isMounted) return
      if (result.ok) { settings.value = result.data; markSaved() }
      else errorMessage.value = result.error.message
    } catch { if (isMounted) errorMessage.value = '无法保存检测到的 ES 路径，请重试。' }
  }
}

const categories = [
  { id: 'general', label: '通用', icon: Settings2, description: '启动行为与平台管理入口。' },
  { id: 'launcher', label: 'Launcher', icon: Search, description: '搜索框布局、快捷键与本机搜索服务。' },
  { id: 'super-panel', label: 'Super Panel', icon: Mouse, description: '由 NativeHost 管理的鼠标触发与上下文操作。' },
  { id: 'ai', label: 'AI', icon: Sparkles, description: 'WebTools 共用的提供方、模型与安全凭据。' },
  { id: 'appearance', label: '外观', icon: Palette, description: '选择窗口颜色主题。' },
  { id: 'advanced', label: '高级', icon: Info, description: '版本信息与现有开发工具入口。' },
] as const
type SettingsSection = typeof categories[number]['id']
const activeCategory = ref<SettingsSection>(props.superPanelFocusRequestId ? 'super-panel' : props.aiFocusRequestId ? 'ai' : 'general')
const activeDescription = computed(() => categories.find(category => category.id === activeCategory.value)?.description)
const categoryContent = ref<HTMLElement | null>(null)
const aiEditor = ref<InstanceType<typeof SharedAISettings> | null>(null)
const superPanelEditor = ref<InstanceType<typeof SuperPanelSettings> | null>(null)
const pendingCategory = ref<SettingsSection | null>(null)
const loading = ref(true)
const loaded = ref(false)
const savingStartup = ref(false)
const version = ref('')
const navigationBusy = computed(() => savingShortcut.value || savingTheme.value || savingLauncherMode.value || savingStartup.value || Boolean(aiEditor.value?.busy) || Boolean(superPanelEditor.value?.busy))
let loadGeneration = 0

function selectCategory(category: SettingsSection): void {
  if (activeCategory.value === category) return
  if (navigationBusy.value) {
    errorMessage.value = '请等待当前保存或测试操作完成后切换分类。'
    return
  }
  if (pendingShortcut.value || recordingShortcut.value || aiEditor.value?.hasPendingChanges || superPanelEditor.value?.hasPendingChanges) {
    pendingCategory.value = category
    return
  }
  switchCategory(category)
}
function switchCategory(category: SettingsSection): void {
  pendingCategory.value = null
  cancelPendingShortcut()
  errorMessage.value = ''
  saved.value = false
  activeCategory.value = category
  if (category === 'launcher' && loaded.value) void refreshEverything()
}
function confirmCategorySwitch(): void {
  if (pendingCategory.value && !navigationBusy.value) switchCategory(pendingCategory.value)
}
async function focusCategory(category: SettingsSection): Promise<void> {
  selectCategory(category)
  await nextTick()
  if (isMounted) categoryContent.value?.focus({ preventScroll: true })
}
watch(() => props.superPanelFocusRequestId, value => { if (value) void focusCategory('super-panel') })
watch(() => props.aiFocusRequestId, value => { if (value) void focusCategory('ai') })

async function loadSettings(): Promise<void> {
  const generation = ++loadGeneration
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await window.desktop.getSettings()
    if (!isMounted || generation !== loadGeneration) return
    settings.value = result
    loaded.value = true
    if (activeCategory.value === 'launcher') void refreshEverything()
  } catch { if (isMounted && generation === loadGeneration) errorMessage.value = '无法读取本机设置，请重试。' }
  finally { if (isMounted && generation === loadGeneration) loading.value = false }
}
onMounted(() => {
  isMounted = true
  void loadSettings()
  void window.desktop.getVersion().then(value => { if (isMounted) version.value = value }, () => {})
})
onBeforeUnmount(() => {
  isMounted = false
  ++loadGeneration
  ++everythingGeneration
  if (savedTimer !== undefined) window.clearTimeout(savedTimer)
})
</script>

<template>
  <section class="content-page settings-page platform-settings-page">
    <div class="page-heading"><div><p class="eyebrow">平台偏好</p><h1>设置</h1><p class="page-description">管理 WebTools 平台；单个插件的配置由插件详情管理。</p></div></div>
    <nav class="settings-categories" aria-label="设置分类">
      <button v-for="category in categories" :key="category.id" type="button" :class="{ selected: activeCategory === category.id }" :aria-current="activeCategory === category.id ? 'page' : undefined" :disabled="navigationBusy" @click="selectCategory(category.id)"><component :is="category.icon" aria-hidden="true" /><span>{{ category.label }}</span></button>
    </nav>
    <p class="settings-category-description">{{ activeDescription }}</p>
    <div v-if="pendingCategory" class="settings-group" role="alert"><p class="settings-note">当前分类有未保存的更改，是否放弃并切换？</p><div class="hotkey-pending-actions"><button type="button" class="secondary-button" @click="pendingCategory = null">继续编辑</button><button type="button" class="secondary-button" :disabled="navigationBusy" @click="confirmCategorySwitch">放弃并切换</button></div></div>
    <p v-if="loading" class="settings-note" role="status">正在读取设置…</p>
    <div v-if="loaded" ref="categoryContent" class="settings-category-content" tabindex="-1">
      <template v-if="activeCategory === 'general'">
        <div class="settings-group">
          <div class="settings-group-heading"><span class="settings-group-icon"><Settings2 :size="17" /></span><div><strong>启动行为</strong><p>启动与全局输入由 NativeHost 负责。</p></div></div>
          <div class="shortcut-row"><div><strong>登录 Windows 时启动</strong><small>启动到托盘，不自动打开 Manager</small></div><button type="button" class="toggle-switch" :class="{ enabled: settings.launchOnStartup }" role="switch" aria-label="登录 Windows 时启动" :aria-checked="settings.launchOnStartup" :disabled="savingStartup" @click="toggleStartup"><span /></button></div>
        </div>
        <div class="settings-group">
          <div class="settings-group-heading"><span class="settings-group-icon"><Puzzle :size="17" /></span><div><strong>插件管理</strong><p>管理已安装的插件、权限与信息。</p></div></div>
          <button type="button" class="secondary-button" @click="emit('openPluginManagement')">管理插件</button>
        </div>
      </template>
      <template v-else-if="activeCategory === 'launcher'">
    <div class="settings-group launcher-mode-settings">
      <div class="settings-group-heading"><span class="settings-group-icon" aria-hidden="true">▤</span><div><strong>搜索框显示模式</strong><p>设置快捷键唤出搜索框时的初始布局</p></div></div>
      <div class="preference-options launcher-mode-options" role="group" aria-label="搜索框显示模式">
        <button class="preference-option preference-option-described" :class="{ selected: settings.launcherDisplayMode === 'compact' }" :aria-pressed="settings.launcherDisplayMode === 'compact'" :disabled="savingLauncherMode" @click="saveLauncherMode('compact')">
          <span><span class="preference-option-title">简洁模式</span><small>只显示搜索框和整体展开按钮</small></span><Check v-if="settings.launcherDisplayMode === 'compact'" :size="14" />
        </button>
        <button class="preference-option preference-option-described" :class="{ selected: settings.launcherDisplayMode === 'expanded' }" :aria-pressed="settings.launcherDisplayMode === 'expanded'" :disabled="savingLauncherMode" @click="saveLauncherMode('expanded')">
          <span><span class="preference-option-title">展开模式</span><small>默认显示收藏网址和应用模块</small></span><Check v-if="settings.launcherDisplayMode === 'expanded'" :size="14" />
        </button>
      </div>
    </div>
    <div class="settings-group shortcut-settings">
      <div class="settings-group-heading"><span class="settings-group-icon"><Keyboard :size="17" /></span><div><strong>快速搜索快捷键</strong><p>选择一个唤起方式，应用后会在后台全局生效</p></div></div>
      <div class="hotkey-options-group">
        <strong>常用组合</strong>
        <div class="hotkey-options" role="group" aria-label="常用组合">
          <button v-for="option in shortcutPresets" :key="option.value" type="button" class="hotkey-option" :class="{ selected: (pendingShortcut ?? settings.quickSearchShortcut) === option.value, pending: pendingShortcut === option.value }" :aria-pressed="(pendingShortcut ?? settings.quickSearchShortcut) === option.value" :disabled="savingShortcut" @click="stageShortcut(option.value)">
            <span>{{ option.label }}</span><Check v-if="(pendingShortcut ?? settings.quickSearchShortcut) === option.value" :size="14" />
          </button>
        </div>
      </div>
      <div class="hotkey-options-group">
        <strong>快速触发</strong>
        <div class="hotkey-options" role="group" aria-label="快速触发">
          <button v-for="option in doubleModifierPresets" :key="option.value" type="button" class="hotkey-option" :class="{ selected: (pendingShortcut ?? settings.quickSearchShortcut) === option.value, pending: pendingShortcut === option.value }" :aria-pressed="(pendingShortcut ?? settings.quickSearchShortcut) === option.value" :disabled="savingShortcut" @click="stageShortcut(option.value)">
            <span>{{ option.label }}</span><Check v-if="(pendingShortcut ?? settings.quickSearchShortcut) === option.value" :size="14" />
          </button>
        </div>
      </div>
      <div class="hotkey-options-group">
        <strong>功能键</strong>
        <div class="hotkey-options function-key-options" role="group" aria-label="功能键 F1 到 F10">
          <button v-for="option in functionKeyPresets" :key="option.value" type="button" class="hotkey-option" :class="{ selected: (pendingShortcut ?? settings.quickSearchShortcut) === option.value, pending: pendingShortcut === option.value }" :aria-pressed="(pendingShortcut ?? settings.quickSearchShortcut) === option.value" :disabled="savingShortcut" @click="stageShortcut(option.value)">
            <span>{{ option.label }}</span><Check v-if="(pendingShortcut ?? settings.quickSearchShortcut) === option.value" :size="14" />
          </button>
        </div>
      </div>
      <div class="hotkey-options-group">
        <strong>高级自定义</strong>
        <div class="custom-hotkey-row"><span>录制 Ctrl、Alt、Shift 或 Win 组合键</span><button type="button" class="secondary-button shortcut-recorder" :class="{ recording: recordingShortcut }" :disabled="savingShortcut" :aria-pressed="recordingShortcut" @click="beginShortcutCapture" @keydown="handleShortcutKeydown">{{ recordingShortcut ? '按下组合键…（Esc 取消）' : '录制组合键' }}<Keyboard v-if="!recordingShortcut" :size="14" /></button></div>
      </div>
      <div class="hotkey-binding-status" aria-live="polite"><span>当前生效</span><kbd>{{ formatShortcut(settings.quickSearchShortcut) }}</kbd><span v-if="pendingShortcut" class="hotkey-pending-label">待应用：{{ displayedShortcut }}</span></div>
      <div v-if="pendingShortcut" class="hotkey-pending-actions"><button type="button" class="primary-button" :disabled="savingShortcut" @click="applyPendingShortcut">{{ savingShortcut ? '应用中…' : '应用' }}</button><button type="button" class="secondary-button" :disabled="savingShortcut" @click="cancelPendingShortcut">取消</button></div>
      <p v-if="shortcutMessage" class="inline-error hotkey-error" role="alert">{{ shortcutMessage }}</p>
    </div>
    <SearchEngineEditor :settings="settings" @saved="handleEnginesSaved" />
    <div class="settings-group everything-settings">
      <div class="settings-group-heading"><span class="settings-group-icon"><FolderSearch :size="17" /></span><div><strong>Everything 文件搜索</strong><p>使用 file:关键词 在本机 Everything 索引中搜索</p></div></div>
      <div class="shortcut-row"><div><strong>启用文件搜索</strong><small>需要单独安装并运行 Everything；WebTools 不会捆绑它</small></div><button class="toggle-switch" :class="{ enabled: settings.everythingEnabled }" role="switch" :aria-checked="settings.everythingEnabled" @click="toggleEverything"><span /></button></div>
      <div class="everything-path-row"><div><strong>ES 命令行工具</strong><small>{{ everythingStatus?.running ? `Everything 正在运行${everythingStatus.version ? ` · ES ${everythingStatus.version}` : ''}` : everythingStatus?.executablePath ? '已找到 ES，但 Everything 尚未运行' : '尚未找到 es.exe' }}</small><code v-if="settings.everythingEsPath">{{ settings.everythingEsPath }}</code></div><div><button class="secondary-button" :disabled="checkingEverything" @click="autoDetectEverything">{{ checkingEverything ? '检测中…' : '自动检测' }}</button><button class="secondary-button" @click="browseEverything">浏览</button></div></div>
      <p class="settings-note">在搜索框输入 <kbd>file:</kbd> 再输入关键词，例如 <kbd>file:meeting notes</kbd>。文件搜索结果只显示文件名和所在文件夹名称。</p>
    </div>
      </template>
      <SuperPanelSettings v-else-if="activeCategory === 'super-panel'" ref="superPanelEditor" :focus-request-id="props.superPanelFocusRequestId" />
      <SharedAISettings v-else-if="activeCategory === 'ai'" ref="aiEditor" @saved="handleEnginesSaved" />
      <template v-else-if="activeCategory === 'appearance'">
    <div class="settings-group appearance-settings">
      <div class="settings-group-heading"><span class="settings-group-icon" aria-hidden="true">◐</span><div><strong>外观主题</strong><p>选择 WebTools 窗口使用的颜色主题</p></div></div>
      <div class="preference-options theme-options" role="group" aria-label="外观主题">
        <button v-for="option in [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }] as const" :key="option.value" class="preference-option" :class="{ selected: settings.theme === option.value }" :aria-pressed="settings.theme === option.value" :disabled="savingTheme" @click="saveTheme(option.value)">
          <span class="preference-option-title">{{ option.label }}</span><Check v-if="settings.theme === option.value" :size="14" />
        </button>
      </div>
    </div>
      </template>
      <template v-else-if="activeCategory === 'advanced'">
        <div class="settings-group">
          <div class="settings-group-heading"><span class="settings-group-icon"><Info :size="17" /></span><div><strong>版本信息</strong><p>WebTools {{ version || '版本信息暂不可用' }}</p></div></div>
          <p class="settings-note">NativeHost 提供原生搜索与输入；Electron Host 按需承载 Manager 和插件功能。</p>
        </div>
        <div class="settings-group">
          <div class="settings-group-heading"><span class="settings-group-icon"><Puzzle :size="17" /></span><div><strong>插件开发与运行诊断</strong><p>在插件管理中展开已有开发者工具，查看当前开发连接与运行状态。</p></div></div>
          <button type="button" class="secondary-button" @click="emit('openPluginManagement')">打开插件管理</button>
          <p class="settings-note">诊断继续使用现有开发工具；此处不读取凭据或自动启动插件。</p>
        </div>
      </template>
    </div>
    <p v-if="saved" class="save-indicator" role="status"><Check :size="14" /> 已保存</p>
    <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
    <button v-if="!loaded && !loading" type="button" class="secondary-button" @click="loadSettings">重新读取设置</button>
  </section>
</template>

<style scoped>
.preference-options { display: grid; gap: 8px; }
.theme-options { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.launcher-mode-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.preference-option { display: flex; min-width: 0; min-height: 42px; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 8px; color: var(--text); background: var(--surface-raised); text-align: left; cursor: pointer; }
.preference-option:hover:not(:disabled) { border-color: var(--accent); background: var(--hover); }
.preference-option.selected { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.preference-option:disabled { cursor: wait; opacity: .75; }
.preference-option-title { font-size: 11px; font-weight: 600; }
.preference-option-described { min-height: 58px; }
.preference-option-described > span { display: grid; gap: 5px; }
.preference-option small { color: var(--muted); font-size: 9px; line-height: 1.4; }
.shortcut-settings { display: grid; gap: 18px; }
.shortcut-settings > .settings-group-heading { margin-bottom: -4px; }
.hotkey-options-group { display: grid; gap: 8px; }
.hotkey-options-group > strong { color: var(--text); font-size: 10px; font-weight: 650; }
.hotkey-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 7px; }
.function-key-options { grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); }
.hotkey-option { display: flex; min-width: 0; min-height: 38px; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--text); background: var(--surface-raised); font: inherit; font-size: 10px; text-align: left; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
.hotkey-option:hover:not(:disabled) { border-color: var(--accent); background: var(--hover); }
.hotkey-option.selected { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.hotkey-option.pending { border-style: dashed; }
.hotkey-option:focus-visible, .shortcut-recorder:focus-visible, .hotkey-pending-actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.hotkey-option:disabled { cursor: wait; opacity: .7; }
.custom-hotkey-row, .hotkey-binding-status, .hotkey-pending-actions { display: flex; align-items: center; gap: 8px; }
.custom-hotkey-row { justify-content: space-between; flex-wrap: wrap; color: var(--muted); font-size: 10px; }
.shortcut-recorder { display: inline-flex; min-width: 120px; justify-content: center; align-items: center; gap: 7px; }
.shortcut-recorder.recording { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.hotkey-binding-status { min-height: 32px; flex-wrap: wrap; color: var(--muted); font-size: 10px; }
.hotkey-binding-status kbd { padding: 3px 7px; border: 1px solid var(--line); border-radius: 5px; color: var(--text); background: var(--surface-raised); font: inherit; }
.hotkey-pending-label { color: var(--accent); }
.hotkey-pending-actions .primary-button, .hotkey-pending-actions .secondary-button { min-width: 82px; }
.hotkey-error { margin: -10px 0 0; }
@media (max-width: 680px) { .theme-options, .launcher-mode-options { grid-template-columns: 1fr; } }
.settings-categories { display: flex; flex-wrap: wrap; gap: calc(var(--manager-unit) * .4); margin-bottom: var(--manager-unit); }
.settings-categories button { display: inline-flex; align-items: center; gap: calc(var(--manager-unit) * .5); padding: calc(var(--manager-unit) * .55) calc(var(--manager-unit) * .75); border: 1px solid transparent; border-radius: calc(var(--manager-unit) * .5); background: transparent; color: var(--muted); font: inherit; font-size: var(--manager-font-body); cursor: pointer; }
.settings-categories button svg { width: var(--manager-unit); height: var(--manager-unit); }
.settings-categories button:hover { background: var(--hover); color: var(--text); }
.settings-categories button.selected { color: var(--accent); background: var(--accent-soft); }
.settings-categories button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.settings-category-description { margin: 0 0 var(--manager-unit); color: var(--muted); font-size: var(--manager-font-body); }
.settings-category-content { min-width: 0; }
.settings-category-content:focus { outline: none; }
</style>
