import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFileSync, mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { BrowserWindow, NativeImage } from 'electron'

interface WindowRequest { requestId: string; entry: string; pluginId: string; startup: 'cold' | 'warm'; presented?: BrowserWindow }
const request = new AsyncLocalStorage<WindowRequest>()
export const currentWindowRequest = () => request.getStore()
export function withWindowRequest<T>(value: WindowRequest, action: () => T): T { return request.run(value, action) }
export function bindWindowStartupTrace(): typeof traceWindowStartup {
  const context = request.getStore()
  return (stage, frame) => context ? request.run(context, () => traceWindowStartup(stage, frame)) : traceWindowStartup(stage, frame)
}

// Enabled only for local startup measurements; contains no input text or secrets.
export function traceWindowStartup(stage: string, frame?: NativeImage): void {
  const directory = process.env.WEBTOOLS_STARTUP_TRACE_DIR
  if (!directory || !isAbsolute(directory)) return
  const context = request.getStore()
  try {
    mkdirSync(directory, { recursive: true })
    const unixMs = Date.now()
    appendFileSync(join(directory, 'electron-startup.jsonl'), JSON.stringify({ stage, unixMs, monotonicMs: performance.now(),
      processId: process.pid, requestId: context?.requestId, entry: context?.entry, pluginId: context?.pluginId, startup: context?.startup,
      ...(frame && !frame.isEmpty() ? { frameSize: frame.getSize() } : {}) }) + '\n')
  } catch { /* Diagnostics cannot interrupt opening a window. */ }
}

/**
 * Load the target document without showing a preliminary Electron surface.
 * Plugin windows also wait for their runtime page before calling presentWindow.
 */
export async function loadWindowShell(window: BrowserWindow, load: () => Promise<unknown>): Promise<void> {
  const trace = bindWindowStartupTrace()
  let clean = () => {}
  const painted = new Promise<void>((resolve, reject) => {
    const closed = () => { clean(); reject(new Error('Window closed before its first shell frame.')) }
    const ready = () => { clean(); resolve() }
    clean = () => { window.removeListener('ready-to-show', ready); window.removeListener('closed', closed) }
    window.once('ready-to-show', ready); window.once('closed', closed)
  })
  try {
    await Promise.all([painted, load()])
    if (window.isDestroyed()) throw new Error('Window closed before its shell could be presented.')

    window.setOpacity(0)
    trace('target-document-ready')
  } finally { clean() }
}

export async function presentWindow(window: BrowserWindow,
  completeHandoff: (requestId: string, window: BrowserWindow) => Promise<boolean>): Promise<void> {
  const context = request.getStore()
  if (context?.presented === window) return
  if (window.isDestroyed()) throw new Error('Plugin window closed before presentation.')
  // NativeHost swaps the prepared Electron HWND and the matching WPF surface in
  // one Win32 batch. It validates ownership and never caches the HWND.
  const swapped = context ? await completeHandoff(context.requestId, window) : false
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  if (!swapped) window.showInactive()
  // NativeHost reveals the staged Electron HWND while hiding WPF. Keep
  // Electron's cached opacity in sync with that acknowledgement.
  window.setOpacity(1)
  traceWindowStartup('target-window-presented')
  window.show(); window.focus()
  if (context) context.presented = window
  traceWindowStartup('target-window-focused')
}
