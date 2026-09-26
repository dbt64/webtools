<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, FolderSearch, Keyboard, KeyRound } from '@lucide/vue'
import { createDefaultAppData, type AppSettings } from '@/shared/domain'
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
    testMessage.value 