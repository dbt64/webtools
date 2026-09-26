<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, FolderSearch, Keyboard, KeyRound } from '@lucide/vue'
import { createDefaultAppData, type AppSettings, type LauncherDisplayMode, type ThemePreference } from '@/shared/domain'
import { applyTheme } from '@/shared/theme'
import SearchEngineEditor from './SearchEngineEditor.vue'

const settings = ref<AppSettings>(createDefaultAppData().settings)
const saved = ref(false)
const errorMessage = ref('')
const apiKey = ref('')
const hasSavedKey = ref(false)
const testing = ref(false)
const testMessage = ref('')
const recordingShortcut = ref(false)
const savingShortcut = ref(false)
const savingTheme = ref(false)
const savingLauncherMode = ref(false)
const everythingStatus = ref<{ executablePath?: string; running: boolean; version?: string }>()
const checkingEverything = ref(false)

function markSaved(): void { saved.value = true; window.setTimeout(() => { saved.value = false }, 1800) }

async function updateShortcut(shortcut: string): Promise<void> {
  savingShortcut.value = true
  const result = await window.desktop.updateSettings({ quickSearchShortcut: shortcut })
  savingShortcut.value = false
  if (!result.ok) { errorMessage.value = result.error.message; recordingShortcut.value = false; return }
  settings.value = result.data
  errorMessage.value = ''
  recordingShortcut.value = false
  markSaved()
}

function handleShortcutKeydown(event: KeyboardEvent): void {
  if (!recordingShortcut.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') { recordingShortcut.value = false; return }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
  const modifiers = [event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Super' : ''].filter(Boolean)
  if (!modifiers.length) return
  const names: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', PageUp: 'PageUp', PageDown: 'PageDown' }
  const key = names[event.key] ?? (/^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : event.key)
  if (!/^[A-Z0-9]$/.test(key) && !/^F(?:[1-9]|1[0-2])$/.test(key) && !['Space', 'Up', 'Down', 'Left', 'Right', 'PageUp', 'PageDown', 'Home', 'End', 'Insert', 'Delete', 'Backspace', 'Tab', 'Enter'].includes(key)) {
    errorMessage.value = '此按键不能用作全局快捷键，请尝试字母、数字或功能键。'
    return
  }
  void updateShortcut([...modifiers, key].join('+'))
}

async function toggleStartup(): Promise<void> {
  const result = await window.desktop.updateSettings({ launchOnStartup: !settings.value.launchOnStartup })
  if (!result.ok) errorMessage.value = result.error.message
  else { settings.value = result.data; errorMessage.value = ''; markSaved() }
}

function handleEnginesSaved(value: AppSettings): void { settings.value = value; markSaved() }

async function saveTheme(theme: ThemePreference): Promise<void> {
  if (savingTheme.value || theme === settings.value.theme) return
  savingTheme.value = true
  try {
    const result = await window.desktop.updateSettings({ theme })
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
  checkingEverything.value = true
  everythingStatus.value = await window.desktop.detectEverything()
  checkingEverything.value = false
}

async function toggleEverything(): Promise<void> {
  const result = await window.desktop.updateSettings({ everythingEnabled: !settings.value.everythingEnabled })
  if (!result.ok) errorMessage.value = result.error.message
  else { settings.value = result.data; errorMessage.value = ''; markSaved(); if (settings.value.everythingEnabled) void refreshEverything() }
}

async function browseEverything(): Promise<void> {
  const path = await window.desktop.chooseEverythingPath()
  if (!path) return
  const result = await window.desktop.updateSettings({ everythingEsPath: path })
  if (!result.ok) { errorMessage.value = result.error.message; return }
  settings.value = result.data
  errorMessage.value = ''
  markSaved()
  await refreshEverything()
}

async function autoDetectEverything(): Promise<void> {
  await refreshEverything()
  if (everythingStatus.value?.executablePath && !settings.value.everythingEsPath) {
    const result = await window.desktop.updateSettings({ everythingEsPath: everythingStatus.value.executablePath })
    if (result.ok) settings.value = result.data
    else errorMessage.value = result.error.message
  }
}

async function saveAiSettings(): Promise<boolean> {
  const result = await window.desktop.updateSettings({ aiBaseUrl: settings.value.aiBaseUrl.trim(), aiModel: settings.value.aiModel.trim() })
  if (!result.ok) { errorMessage.value = result.error.message; return false }
  settings.value = result.data
  if (apiKey.value.trim()) {
    const keyResult = await window.desktop.saveAiApiKey(apiKey.value.trim())
    if (!keyResult.ok) { errorMessage.value = keyResult.error.message; return false }
    hasSavedKey.value = true
    apiKey.value = ''
  }
  saved.value = true
  errorMessage.value = ''
  window.setTimeout(() => { saved.value = false }, 1800)
  return true
}

async function testConnection(): Promise<void> {
  testing.value = true
  testMessage.value = ''
  try {
    if (!await saveAiSettings()) return
    const result = await window.desktop.testAiConnection()
    testMessage.value = result.ok ? `已连接 · ${result.data.model}` : result.error.message
  } catch {
    testMessage.value = '无法连接 AI 服务，请检查网络和设置。'
  } finally {
    testing.value = false
  }
}

async function clearKey(): Promise<void> {
  if (!window.confirm('删除已保存的 API Key？')) return
  const result = await window.desktop.clearAiApiKey()
  if (!result.ok) errorMessage.value = result.error.message
  else { hasSavedKey.value = false; errorMessage.value = ''; testMessage.value = '已删除 API Key。' }
}

onMounted(async () => {
  try {
    settings.value = await window.desktop.getSettings()
    hasSavedKey.value = await window.desktop.hasAiApiKey()
    await refreshEverything()
  } catch {
    errorMessage.value = '无法读取本机设置。'
  }
})
</script>

<template>
  <section class="content-page settings-page">
    <div class="page-heading"><div><p class="eyebrow">偏好与连接</p><h1>设置</h1><p class="page-description">调整 WebTools 的搜索方式与服务连接。</p></div></div>
    <SearchEngineEditor :settings="settings" @saved="handleEnginesSaved" />
    <div class="settings-group appearance-settings">
      <div class="settings-group-heading"><span class="settings-group-icon" aria-hidden="true">◐</span><div><strong>外观主题</strong><p>选择 WebTools 窗口使用的颜色主题</p></div></div>
      <div class="preference-options theme-options" role="group" aria-label="外观主题">
        <button v-for="option in [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }] as const" :key="option.value" class="preference-option" :class="{ selected: settings.theme === option.value }" :aria-pressed="settings.theme === option.value" :disabled="savingTheme" @click="saveTheme(option.value)">
          <span class="preference-option-title">{{ option.label }}</span><Check v-if="settings.theme === option.value" :size="14" />
        </button>
      </div>
    </div>
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
      <div class="settings-group-heading"><span class="settings-group-icon"><Keyboard :size="17" /></span><div><strong>快速搜索快捷键</strong><p>在其他应用中按下快捷键显示 WebTools 搜索框</p></div></div>
      <div class="shortcut-row"><div><strong>唤起搜索框</strong><small>快捷键会在后台全局生效</small></div><button class="shortcut-recorder" :class="{ recording: recordingShortcut }" :disabled="savingShortcut" @click="recordingShortcut = true" @keydown="handleShortcutKeydown">{{ recordingShortcut ? '按下组合键…（Esc 取消）' : settings.quickSearchShortcut.replace('Control', 'Ctrl').replace('Super', 'Win') }}<span v-if="!recordingShortcut">⌨</span></button></div>
      <div class="shortcut-row"><div><strong>登录 Windows 时启动</strong><small>启动到托盘，随时可用全局快捷键</small></div><button class="toggle-switch" :class="{ enabled: settings.launchOnStartup }" role="switch" :aria-checked="settings.launchOnStartup" @click="toggleStartup"><span /></button></div>
    </div>
    <div class="settings-group everything-settings">
      <div class="settings-group-heading"><span class="settings-group-icon"><FolderSearch :size="17" /></span><div><strong>Everything 文件搜索</strong><p>使用 file:关键词 在本机 Everything 索引中搜索</p></div></div>
      <div class="shortcut-row"><div><strong>启用文件搜索</strong><small>需要单独安装并运行 Everything；WebTools 不会捆绑它</small></div><button class="toggle-switch" :class="{ enabled: settings.everythingEnabled }" role="switch" :aria-checked="settings.everythingEnabled" @click="toggleEverything"><span /></button></div>
      <div class="everything-path-row"><div><strong>ES 命令行工具</strong><small>{{ everythingStatus?.running ? `Everything 正在运行${everythingStatus.version ? ` · ES ${everythingStatus.version}` : ''}` : everythingStatus?.executablePath ? '已找到 ES，但 Everything 尚未运行' : '尚未找到 es.exe' }}</small><code v-if="settings.everythingEsPath">{{ settings.everythingEsPath }}</code></div><div><button class="secondary-button" :disabled="checkingEverything" @click="autoDetectEverything">{{ checkingEverything ? '检测中…' : '自动检测' }}</button><button class="secondary-button" @click="browseEverything">浏览</button></div></div>
      <p class="settings-note">在搜索框输入 <kbd>file:</kbd> 再输入关键词，例如 <kbd>file:meeting notes</kbd>。文件搜索结果只显示文件名和所在文件夹名称。</p>
    </div>
    <div class="settings-group ai-settings">
      <div class="settings-group-heading"><span class="settings-group-icon"><KeyRound :size="17" /></span><div><strong>AI 翻译服务</strong><p>OpenAI 兼容接口 · 支持 OpenAI、DeepSeek</p></div></div>
      <label class="field-label">服务地址<input v-model="settings.aiBaseUrl" placeholder="https://api.openai.com/v1 或 https://api.deepseek.com" /></label>
      <label class="field-label">模型名称<input v-model="settings.aiModel" placeholder="例如：gpt-4o-mini 或 deepseek-chat" /></label>
      <label class="field-label">API Key<input v-model="apiKey" type="password" autocomplete="new-password" :placeholder="hasSavedKey ? '已安全保存；输入新值可替换' : '输入 API Key'" /></label>
      <p class="secret-note">API Key 使用 Windows 安全存储加密，不会写入普通设置文件。连接测试会发送一次简短请求。</p>
      <div class="ai-settings-actions"><button class="primary-button" @click="saveAiSettings">保存设置</button><button class="secondary-button" :disabled="testing" @click="testConnection">{{ testing ? '正在连接…' : '测试连接' }}</button><button v-if="hasSavedKey" class="text-button remove-key" @click="clearKey">移除已保存的 Key</button></div>
      <p v-if="testMessage" class="settings-result">{{ testMessage }}</p>
    </div>
    <p v-if="saved" class="save-indicator"><Check :size="14" /> 已保存</p><p v-if="errorMessage" class="inline-error">{{ errorMessage }}</p>
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
@media (max-width: 680px) { .theme-options, .launcher-mode-options { grid-template-columns: 1fr; } }
</style>
