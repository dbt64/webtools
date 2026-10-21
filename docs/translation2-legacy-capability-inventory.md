# Translation 2.0 Legacy Capability Inventory

**Date:** 2026-10-18\
**Authority:** `docs/superpowers/specs/2026-10-18-translation-provider-tabs-design.md`\
**Status:** Updated after the 2026-10-18 packaged review. The user directed immediate Legacy UI/route/handoff removal. Shared services and existing user data remain; this correction does not erase or reinterpret credentials. See `docs/translation2-settings-correction.md`.

## Decisions

| Legacy capability | Decision | Translation 2.0 behavior | Data handling before cutover |
|---|---|---|---|
| Manager `TranslateView` route and page chrome | Removed under the packaged-review instruction | Translation owns a dedicated built-in plugin window/surface. | Old Manager UI/handoff removed; existing user data retained. |
| Exact selected-text / Launcher prefill | Retain | Open or focus Translation 2.0 with the exact newest source text. | Native full-translation entry points now use the dedicated window directly. |
| Source and target language selection | Retain | Native `WebTools 翻译` tab owns source/target controls using the shared language catalog. | Read Legacy defaults only through an explicit mapping; do not rewrite them during foundation work. |
| Request IDs, cancellation, timeout, stale-result guards | Retain | Main remains authoritative; closing, disabling, source replacement, service change, or a newer request invalidates old work. | Dedicated-window lifecycle now owns full Translation requests. |
| MyMemory direct translation | Retain for the initial native machine-service path | A built-in named machine service `MyMemory 免费翻译`; it remains distinct from website and AI providers. | No secret migration. Existing engine choice is not silently promoted to the 2.0 default until cutover review. |
| Shared AI translation | Retain | `AI 翻译` uses the existing AI Provider Registry, models, credentials, and `SharedAI.complete()` prompt route. | Reuse existing provider settings and keys; Translation must not create a second AI credential store. |
| Qwen-MT specialized route | Remove from the initial 2.0 scope | No new adapter work is scheduled. Qwen remains available as a normal Shared AI provider where already configured. | Retain only any still-referenced preview support; do not migrate the `qwenMtModel` setting into a new direct service. |
| Legacy single `engine` selector | Replace | 2.0 separates named machine-service instances from AI provider/model choices and website tabs. | Preserve the old value for existing preview compatibility; do not reinterpret it as a website or imported service. |
| Google Translate external-browser button | Replace | Google is a website-tab candidate with its own isolated page, subject to provider-flow and security acceptance. | Remove the Legacy button; Google now has an isolated website tab. |
| Super Panel automatic translation preview | Retain as a separate feature | Quick Result remains in the Super Panel and never replaces the full Translation entry. | Full Translation must cancel/invalidate preview and open Translation 2.0 after cutover. |
| Copy result | Retain | The native tab offers an explicit copy action. | Clipboard behavior remains user initiated. |
| Translation history or persistent source/result | Remove / not introduced | No history is added; closing the Translation window destroys source/result view state unless a later product decision says otherwise. | No data migration. |
| Legacy AI key storage and Shared AI settings | Retain through shared ownership | Continue using Main/SecretStore and the Shared AI settings UI/contracts. | Saved key values are never returned to either Translation renderer or website pages. |

## Initial 2.0 catalog boundary

- **Native machine service available in the foundation:** MyMemory.
- **AI services:** the existing Shared AI registry (`OpenAI`, `Anthropic Claude`, `Google Gemini`, `DeepSeek`, `Qwen`, and `Custom / OpenAI-compatible`).
- **Dedicated API implemented:** DeepL API Free/Pro with a named key-entry form. Controlled request/response verification passed; a real paid/account key was not used. Google Cloud Translation and Microsoft Translator remain future candidates.
- **Website candidates:** Youdao, Google, Microsoft, Tencent, Sogou, DeepL, Caiyun, and CNKI. All declared provider pages can be shown/hidden/reordered by the user. A selectable tab does not claim verified automatic translation on every live website; historical verification metadata does not disable controls.
- **Imported definitions:** required later as bounded data-only definitions. They cannot contain scripts, executable handlers, plugin manifests, or package lifecycle metadata.

## Cutover instruction after packaged review

The user explicitly requested immediate cutover on 2026-10-18. All full Translation entry points now open the independent Translation 2.0 window. The old Manager UI, gate/handoff and Manager translation IPC/preload methods were removed. Shared AI/MyMemory and preview-used service/settings remain deliberately adopted dependencies. Existing user data and credentials were not deleted. The corrected installer and isolated installation checks are complete; installed Native-entry human verification remains pending. See `docs/translation2-settings-correction.md` for artifact identity and evidence.
