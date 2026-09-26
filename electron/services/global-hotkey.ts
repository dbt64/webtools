import { globalShortcut } from 'electron'
import type { IpcResult } from '../../src/shared/ipc'

export class GlobalHotkeyService {
  private accelerator?: string
  private callback?: () => void

  register(accelerator: string, onTrigger: () => void): IpcResult<void> {
    if (!accelerator.trim()) return { ok: false, error: { code: 'INVALID_SHORTCUT', message: '快捷键不能为空。' } }
    try {
      if (!globalShortcut.register(accelerator, onTrigger)) return { ok: false, error: { code: 'SHORTCUT_UNAVAILABLE', message: `无法注册快捷键 ${accelerator}，可能已被其他程序占用。` } }
    } catch { return { ok: false, error: { code: 'INVALID_SHORTCUT', message: `快捷键 ${accelerator} 格式无效。` } } }
    this.accelerator = accelerator
    this.callback = onTrigger
    return { ok: true, data: undefined }
  }

  replace(next: string): IpcResult<void> {
    if (next === this.accelerator) return { ok: true, data: undefined }
    if (!this.callback) return { ok: false, error: { code: 'SHORTCUT_NOT_INITIALIZED', message: '快捷键服务尚未初始化。' } }
    try {
      if (!globalShortcut.register(next, this.callback)) return { ok: false, error: { code: 'SHORTCUT_UNAVAILABLE', message: `无法注册快捷键 ${next}，当前快捷键仍保持有效。` } }
    } catch { return { ok: false, error: { code: 'INVALID_SHORTCUT', message: `快捷键 ${next} 格式无效，当前快捷键仍保持有效。` } } }
    const previous = this.accelerator
    this.accelerator = next
    if (previous) globalShortcut.unregister(previous)
    return { ok: true, data: undefined }
  }

  dispose(): void {
    globalShortcut.unregisterAll()
    this.accelerator = undefined
    this.callback = undefined
  }
}
