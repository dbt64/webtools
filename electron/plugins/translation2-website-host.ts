import type { Translation2WebsiteProviderId } from '../../src/shared/translation2-contracts.ts'
import type { TranslationLanguageCode, TranslationSourceLanguage } from '../../src/shared/translation-contracts.ts'

export interface Translation2WebsiteBounds { x: number; y: number; width: number; height: number }

interface WebsiteView {
  setBounds(bounds: Translation2WebsiteBounds): void
  webContents: {
    loadURL(url: string): Promise<void>
    getURL(): string
    getZoomFactor(): number
    setZoomFactor(factor: number): void
    executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
    isDestroyed(): boolean
    close(): void
  }
}

interface TranslationWindowSurface {
  contentView: {
    addChildView(view: WebsiteView): void
    removeChildView(view: WebsiteView): void
  }
}

interface Dependencies {
  getWindow(): TranslationWindowSurface | null
  createView(providerId: Translation2WebsiteProviderId): WebsiteView
  clearSession(providerId: Translation2WebsiteProviderId): Promise<void>
  onStateChanged?(state: { providerId: Translation2WebsiteProviderId; phase: 'loading' | 'ready' | 'error'; message: string }): void
}

const WEBSITE_URLS: Record<Translation2WebsiteProviderId, string> = {
  google: 'https://translate.google.com/', youdao: 'https://fanyi.youdao.com/',
  microsoft: 'https://www.bing.com/translator', tencent: 'https://fanyi.qq.com/',
  sogou: 'https://fanyi.sogou.com/text', deepl: 'https://www.deepl.com/translator',
  caiyun: 'https://fanyi.caiyunapp.com/', cnki: 'https://dict.cnki.net/',
}

export function isAllowedTranslationWebsiteUrl(id: Translation2WebsiteProviderId, value: string): boolean {
  try {
    const url = new URL(value), configured = new URL(WEBSITE_URLS[id])
    return url.protocol === 'https:' && (url.origin === configured.origin || id === 'deepl' && url.origin === 'https://deepl.com')
  } catch { return false }
}

export function buildTranslationWebsiteUrl(id: Translation2WebsiteProviderId, text: string, source: TranslationSourceLanguage, target: TranslationLanguageCode): string {
  if (id === 'google') return buildGoogleTranslationUrl(text, source, target)
  const url = new URL(WEBSITE_URLS[id])
  if (id === 'microsoft') { url.searchParams.set('text', text); url.searchParams.set('from', source); url.searchParams.set('to', target === 'zh-CN' ? 'zh-Hans' : target === 'zh-TW' ? 'zh-Hant' : target) }
  else if (id === 'deepl' && text) url.hash = `${source === 'auto' ? 'auto' : source.split('-')[0]}/${target.split('-')[0]}/${encodeURIComponent(text)}`
  else if (id === 'sogou' && text) url.searchParams.set('keyword', text)
  return url.toString()
}

const HIDDEN_BOUNDS: Translation2WebsiteBounds = { x: 0, y: 0, width: 1, height: 1 }

export function buildGoogleTranslationUrl(text: string, source: TranslationSourceLanguage, target: TranslationLanguageCode): string {
  const url = new URL('https://translate.google.com/')
  url.searchParams.set('sl', source)
  url.searchParams.set('tl', target)
  url.searchParams.set('text', text)
  url.searchParams.set('op', 'translate')
  return url.toString()
}

export function isAllowedGoogleTranslationUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'translate.google.com'
  } catch { return false }
}

function validBounds(value: Translation2WebsiteBounds): boolean {
  return [value.x, value.y, value.width, value.height].every(Number.isSafeInteger)
    && value.x >= 0 && value.y >= 0 && value.width >= 1 && value.height >= 1
    && value.x <= 10_000 && value.y <= 10_000 && value.width <= 10_000 && value.height <= 10_000
}

/** Main-owned remote website views for the built-in Translation window. */
export class Translation2WebsiteHost {
  private readonly views = new Map<Translation2WebsiteProviderId, WebsiteView>()
  private readonly loadedInputs = new Map<Translation2WebsiteProviderId, string>()
  private readonly navigationRevisions = new Map<Translation2WebsiteProviderId, number>()
  private active: Translation2WebsiteProviderId | null = null
  private selectionRevision = 0
  private youdaoFitRevision = 0
  private activeGeneration = -1
  private bounds: Translation2WebsiteBounds = HIDDEN_BOUNDS

  constructor(private readonly deps: Dependencies) {}

  setBounds(bounds: Translation2WebsiteBounds): void {
    if (!validBounds(bounds)) throw new Error('Translation website bounds are invalid.')
    this.bounds = { ...bounds }
    if (this.active) {
      const view = this.views.get(this.active)
      view?.setBounds(this.bounds)
      if (this.active === 'youdao') void this.fitYoudaoWidth(view)
    }
  }

  async select(providerId: Translation2WebsiteProviderId | null, sourceText: string, source: TranslationSourceLanguage, target: TranslationLanguageCode, sourceGeneration: number): Promise<{ sourceText: string; sourceSynchronized: boolean }> {
    const revision = ++this.selectionRevision
    const newerHostSource = this.active !== null && sourceGeneration > this.activeGeneration
    const activeSource = newerHostSource ? null : await this.readActiveSource()
    if (revision !== this.selectionRevision) throw new Error('Translation website selection was superseded.')
    const latestSource = activeSource?.sourceText ?? sourceText
    const sourceSynchronized = newerHostSource || this.active === null || activeSource !== null
    if (this.active) this.views.get(this.active)?.setBounds(HIDDEN_BOUNDS)
    this.active = null
    if (providerId === null) return { sourceText: latestSource, sourceSynchronized }
    if (!Object.hasOwn(WEBSITE_URLS, providerId)) throw new Error('Translation website provider is unsupported.')
    const view = this.ensureView(providerId)
    this.active = providerId
    this.activeGeneration = sourceGeneration
    view.setBounds(this.bounds)
    const signature = JSON.stringify([latestSource, source, target])
    if (this.loadedInputs.get(providerId) !== signature) {
      this.loadedInputs.set(providerId, signature)
      const navigation = (this.navigationRevisions.get(providerId) ?? 0) + 1
      this.navigationRevisions.set(providerId, navigation)
      const navigationStartedAt = Date.now()
      this.deps.onStateChanged?.({ providerId, phase: 'loading', message: '' })
      void view.webContents.loadURL(buildTranslationWebsiteUrl(providerId, latestSource, source, target)).then(async () => {
        if (this.views.get(providerId) !== view || this.navigationRevisions.get(providerId) !== navigation) return
        if (providerId === 'youdao' && isAllowedTranslationWebsiteUrl(providerId, view.webContents.getURL())) {
          const prepared = await view.webContents.executeJavaScript(buildYoudaoTextTranslationScript(latestSource), false).catch(() => false)
          if (prepared !== true) throw new Error('Youdao translation tab is unavailable.')
        } else if (latestSource && !['google', 'microsoft', 'deepl', 'sogou'].includes(providerId) && isAllowedTranslationWebsiteUrl(providerId, view.webContents.getURL())) {
          // Data-only handoff to the site's own editable source field; never receives Host credentials.
          const text = JSON.stringify(latestSource)
          await view.webContents.executeJavaScript(`(() => { const el = document.querySelector('textarea, [contenteditable="true"]'); if (!el) return false; if (el instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${text}); else el.textContent = ${text}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, false).catch(() => false)
        }
        if (this.views.get(providerId) === view && this.navigationRevisions.get(providerId) === navigation) {
          if (providerId === 'youdao') await this.fitYoudaoWidth(view)
          console.info('[translation-website] navigation completed', { providerId, elapsedMs: Date.now() - navigationStartedAt })
          this.deps.onStateChanged?.({ providerId, phase: 'ready', message: '' })
        }
      }).catch(() => {
        if (this.views.get(providerId) !== view || this.navigationRevisions.get(providerId) !== navigation) return
        this.loadedInputs.delete(providerId)
        if (this.active === providerId) view.setBounds(HIDDEN_BOUNDS)
        console.warn('[translation-website] navigation failed', { providerId, elapsedMs: Date.now() - navigationStartedAt })
        const message = providerId === 'youdao'
          ? '有道未能进入文本翻译页，请重试；没有改用其他翻译服务。'
          : '网站载入失败，请检查网络后重试；没有改用其他翻译服务。'
        this.deps.onStateChanged?.({ providerId, phase: 'error', message })
      })
    }
    return { sourceText: latestSource, sourceSynchronized }
  }

  async closeAll(): Promise<void> {
    ++this.selectionRevision
    const window = this.deps.getWindow()
    const entries = [...this.views.entries()]
    this.views.clear()
    this.loadedInputs.clear()
    this.navigationRevisions.clear()
    this.active = null
    this.activeGeneration = -1
    await Promise.all(entries.map(async ([providerId, view]) => {
      try { window?.contentView.removeChildView(view) } catch { /* Window may already be closing. */ }
      if (!view.webContents.isDestroyed()) view.webContents.close()
      await this.deps.clearSession(providerId)
    }))
  }

  private ensureView(providerId: Translation2WebsiteProviderId): WebsiteView {
    const existing = this.views.get(providerId)
    if (existing && !existing.webContents.isDestroyed()) return existing
    const window = this.deps.getWindow()
    if (!window) throw new Error('Translation window is unavailable.')
    const view = this.deps.createView(providerId)
    view.setBounds(HIDDEN_BOUNDS)
    window.contentView.addChildView(view)
    this.views.set(providerId, view)
    return view
  }

  private async fitYoudaoWidth(view: WebsiteView | undefined): Promise<void> {
    if (!view || view.webContents.isDestroyed() || this.bounds.width < 200) return
    const boundsWidth = this.bounds.width
    const revision = ++this.youdaoFitRevision
    let value: unknown
    try { value = await view.webContents.executeJavaScript(`(() => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0))()`, false) }
    catch { return /* Keep the provider page usable when its layout cannot be measured. */ }
    if (revision !== this.youdaoFitRevision || this.active !== 'youdao' || this.views.get('youdao') !== view || view.webContents.isDestroyed()) return
    const contentWidth = typeof value === 'number' && Number.isFinite(value) ? value : 0
    if (contentWidth < 1) return
    const nextZoom = Math.max(0.5, Math.min(1, boundsWidth / contentWidth))
    if (Math.abs(view.webContents.getZoomFactor() - nextZoom) > 0.02) view.webContents.setZoomFactor(nextZoom)
  }

  private async readActiveSource(): Promise<{ sourceText: string } | null> {
    if (!this.active) return null
    const view = this.views.get(this.active)
    if (!view || view.webContents.isDestroyed()) return null
    try {
      if (!isAllowedTranslationWebsiteUrl(this.active, view.webContents.getURL())) return null
      let timer: ReturnType<typeof setTimeout> | undefined
      const sourceText = await Promise.race([view.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('textarea[aria-label], textarea, [contenteditable="true"]')
        return input instanceof HTMLTextAreaElement ? input.value.slice(0, 20000) : input?.isContentEditable ? input.textContent.slice(0, 20000) : null
      })()`, false), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 200) })]).finally(() => clearTimeout(timer))
      return typeof sourceText === 'string' ? { sourceText } : null
    } catch { return null }
  }
}

function buildYoudaoTextTranslationScript(text: string): string {
  const value = JSON.stringify(text)
  return `(() => new Promise(resolve => {
    let finished = false;
    let clicked = false;
    let observer;
    const finish = result => { if (finished) return; finished = true; observer?.disconnect(); clearTimeout(timeout); resolve(result); };
    const visible = element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'; };
    const findTextTab = () => {
      const controls = [...document.querySelectorAll('[role="tab"],button,a,[tabindex]')];
      const control = controls.find(element => element.textContent?.trim() === '翻译' && visible(element));
      if (control) return control;
      return [...document.querySelectorAll('body *')].find(element => {
        const classNames = [element, element.parentElement].map(item => item?.className?.toString() ?? '').join(' ');
        return element.children.length === 0 && element.textContent?.trim() === '翻译' && visible(element) && /tab|menu|nav/i.test(classNames);
      });
    };
    const fillText = () => {
      const inputs = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible);
      const input = inputs.find(element => /原文|文本|翻译/i.test([element.getAttribute('placeholder'), element.getAttribute('aria-label')].filter(Boolean).join(' '))) ?? inputs[0];
      if (!input) return false;
      if (input instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(input, ${value});
      } else input.textContent = ${value};
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${value} }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const attempt = () => {
      const tab = findTextTab();
      if (!tab) return false;
      const tabRoot = tab.closest('[role="tab"],button,a,[tabindex]') || tab;
      const roots = [tabRoot, tabRoot.parentElement, tabRoot.parentElement?.parentElement].filter(Boolean);
      const active = roots.some(root => root.getAttribute('aria-selected') === 'true' || root.getAttribute('aria-current') === 'page' || /active|selected|current/i.test(root.className?.toString() ?? ''));
      if (!active && !clicked) {
        clicked = true;
        tabRoot.click();
        requestAnimationFrame(attempt);
        return true;
      }
      if (!active) return true;
      ${text ? `if (fillText()) { finish(true); return true; }` : `finish(true); return true;`}
      return true;
    };
    const timeout = setTimeout(() => finish(false), 8000);
    observer = new MutationObserver(() => { attempt(); });
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    attempt();
  }))()`
}
