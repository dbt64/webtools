# Translation 2.0 — Hybrid Provider Tabs Design

**Date:** 2026-10-18

**Status:** The provider-tab, built-in-plugin, and BYO/custom API directions are approved. Translation 2.0 is a first-party built-in plugin on the completed WebTools Plugin architecture. Its UI and provider flows belong to the plugin window/surface, not Manager. Remaining design work covers legacy capability scope, the initial API catalog, the bounded importable API-definition format, AI Registry reuse, and website execution policies.

**Approved direction:** The user confirmed a browser-style provider tab bar: each hosted translation website gets its own tab, alongside one `WebTools 翻译` tab. Inside the WebTools tab, dedicated machine-translation APIs and AI translation providers are selected in separately labeled groups. Website tabs render the provider's own page/result; the WebTools tab renders WebTools' native translation result.

**Scope:** Translation 2.0 replaces the temporary Legacy Manager Translation as a first-party built-in plugin on the completed plugin architecture. The plugin owns its UI in its own window/surface; it is not a Manager page. The user’s packaged-review instruction removes the old Manager UI/route now; shared services and existing user data remain adopted dependencies. Reuse the existing plugin architecture and lifecycle; add only translation-specific behavior needed by this feature. This document does not authorize production code changes or a generic plugin-lifecycle redesign.

**Evidence cache:** `D:\SystemDefault\Desktop\webtoolstest\utools-translation-analysis-20261018\`

## Packaged-review correction — 2026-10-18

The user's installed review explicitly supersedes the earlier Legacy-retention and website-enablement prerequisites below. Full Translation entry points must now open Translation 2.0 directly; remove the old Manager Translation view, gate/handoff and its IPC. Keep shared services and preview-used settings, and do not erase user data. Website controls may show/hide/reorder all declared provider pages; historical verification metadata must not disable those controls or imply that every site's live translation/autofill has passed acceptance. Keep website isolation, origin restrictions and credential boundaries. The originally approved preset service → provider-specific fields → API Key → test/save workflow is required, with JSON import retained as an advanced option. The concrete correction and verification limits are in `docs/translation2-settings-correction.md`. Earlier retained-Legacy and verified-only website statements are superseded by this section, not instructions for a future implementation.

## 1. User goal

Rebuild Translation 2.0 around one provider bar that combines two different ways to translate:

1. Hosted translation websites such as Youdao, Google Translate, Microsoft/Bing, and Tencent. They appear as browser-like tabs and run their own pages.
2. A first-party `WebTools 翻译` tab that renders a native source/result experience and lets the user select a dedicated machine-translation API service or an eligible AI provider through their respective configuration paths.

The existing 翻译 entry opens the built-in Translation 2.0 plugin when that surface is ready. A supplied source string opens in the currently selected provider: website tabs receive it in their source input; the WebTools tab follows the selected native service flow, either a dedicated machine-translation API adapter or the AI Provider route. The Super Panel's full 翻译 operation sends the exact selected text to and opens or focuses the Translation 2.0 plugin's own window/surface. If a same-panel Quick Result is available, it is a separate action/presentation and must not intercept or replace the full Translation entry. The Legacy Manager route is not a destination.

Before migration, perform a Legacy Capability Inventory & 2.0 Scope Review: mark each old capability as retained, replaced by a new capability, or removed, with no one-for-one preservation obligation. The 2026-09-27 Manager-page plan and earlier first-party Plugin proposal are historical inputs; the chosen architecture is the first-party built-in Translation 2.0 plugin. MyMemory, Shared AI, Qwen-MT, and language/provider settings are inventory items, not automatic retention requirements. Any retained capability is implemented in the new plugin using the existing plugin architecture and the appropriate translation or AI service boundary.

## 2. uTools reverse-engineering evidence

The active IDA target was `uTools-7.8.0.exe`, a small Electron launcher. The translation UI was in the installed first-party plugin package, not the native launcher. The plugin manifest identifies `聚合翻译` (`translatehub`) version `1.3.13` and describes it as browser-based aggregation of online translation websites.

Observed in the local plugin package:

- `preload.js` creates a frameless 1280×800 BrowserWindow with `webviewTag: true`, positions and shows it on plugin entry, and passes the selected text to the renderer.
- The renderer defines eight website providers: Tencent, Youdao, Sogou, DeepL, Microsoft/Bing, Caiyun, CNKI, and Google. Each enabled provider is rendered as its own `<webview>` using the provider URL.
- Provider-specific source selectors are used where needed. The plugin executes JavaScript in the remote page to focus and fill the source field and dispatch an `input` event. Tencent has an additional space-key trigger. When switching sites, it reads the prior provider's source field and sends that text to the next provider.
- The settings menu toggles providers and persists the enabled order under the plugin database key `custom`. If no saved order exists, the shipped code initially enables its first three entries; the reference screenshot shows a configured state with Youdao, Google, Microsoft, and Tencent enabled.
- Translation and result rendering remain inside each provider's own webpage. The plugin does not expose one normalized API-result contract for all these website providers.

The evidence is static analysis of the installed package. It does not prove that each remote website still accepts its current selector or behaves the same at runtime. The extracted package files and complete REA evidence bundle are stored under the evidence cache path above. The primary local excerpts are `utools-translatehub-plugin.json`, `utools-translatehub-preload.js`, and `utools-translatehub-index.js`.

## 3. HomePage current state

| Current area | Observed behavior | Design implication |
|---|---|---|
| `src/shared/translation-contracts.ts` | Engine IDs are `mymemory`, `ai`, and `qwen-mt`; settings select one engine and languages. | Extend the Translation provider model without treating remote websites as API engines. |
| `electron/services/translation-service.ts` | Main routes API-style requests, tracks active request IDs, supports cancellation and provider metadata. | Keep this result/cancellation contract for the WebTools tab and extend it through API adapters. |
| `src/features/translate/TranslateView.vue` | One native source/result view; Google currently opens by external URL. | Replace the single-provider page presentation with the tab surface; the Google website becomes a website tab. |
| `electron/services/ai-provider-registry.ts` | The AI registry supports known AI providers and a custom OpenAI-compatible endpoint. | Reuse its compatible endpoint capability where appropriate; do not claim it accepts arbitrary translation REST protocols. |
| `electron/plugins/web-plugin-runtime.ts` | HomePage already hosts content with Electron `WebContentsView` and restrictive web preferences. | Reuse the platform's main-process-owned embedded-view pattern for remote provider pages; do not copy uTools' `<webview>` implementation verbatim. |
| `electron/plugins/builtin-translation-lifecycle.ts` | Translation feature enable/disable owns generation changes and cancels API work on disable. | Provider views are part of Translation 2.0; they do not need a separate platform lifecycle project. |

The earlier Translation 2.0 plan treats Google Translate as an external browser action and centers the page on API engines. This provider-tab design supersedes those presentation decisions. Existing API capabilities, request validation, cancellation, credential handling, and configuration behavior are inventory inputs; each is explicitly retained, replaced, or removed for 2.0 rather than assumed to be reproduced one-for-one.


### 3.1 Built-in Translation 2.0 plugin ownership

Translation 2.0 is a first-party built-in plugin registered in the completed WebTools Plugin architecture. The plugin owns the provider-tab UI, native translation experience, website views, service catalog and list, provider settings, and feature state. Its UI is rendered in the plugin's own window/surface; it is not placed in Manager. The Super Panel's full 翻译 operation opens or focuses this plugin window with the exact selected text. The old Manager Translation implementation is legacy-only and is not reused as the 2.0 UI.


### 3.2 Use the existing plugin architecture

The new plugin architecture is already in place and is the implementation foundation for Translation 2.0. Reuse its existing plugin registration, window, lifecycle, package validation, and permission mechanisms wherever their contracts fit. Implement provider tabs, translation service management, and translation-specific API adapter calls inside the built-in Translation plugin. If an API adapter requires a missing capability, add the smallest translation-specific integration to the existing architecture; do not reopen the UI ownership decision or create a generic plugin-lifecycle project.

User-imported translation API definitions are configured and used inside the built-in Translation plugin. Importing one adds a data-only service definition; it does not install another plugin, create a second package lifecycle, or move the Translation 2.0 UI into Manager.

## 4. Selected product model


### 4.1 Top-level provider tabs

The tab strip in the built-in Translation 2.0 plugin contains website providers plus one always-available WebTools 翻译 tab. A settings control lets the user enable/disable website providers and reorder them. The first-run default is proposed to match the user's reference image: Youdao, Google, Microsoft, and Tencent enabled; Sogou, DeepL, Caiyun, and CNKI available to enable. This is a proposed catalog/default, not proof that each site is ready. A provider must pass its own autofill, trigger, and security acceptance before it is marked supported or enabled by default. Persist order and visibility in the Translation plugin's settings.

The exact provider catalog and first-run order are configuration values, not code branches in the page component. Do not expose a separate top-level tab for every user-created API endpoint.


### 4.2 Website provider tabs

Each website tab hosts the provider's own website inside the Translation 2.0 surface. It is a browsing experience:

- Load the provider's HTTPS URL and keep that site's translated result on the page.
- On Translation entry with source text, fill the provider's source field and trigger translation. If the site stops accepting the automated flow at runtime, keep it usable with a visible manual-input fallback.
- Every supported/enabled provider must declare and pass a complete automated flow: fill the source and either rely on `auto-on-input` or activate the provider's own submit control with `user-submit`, then show a visible result on that provider's page. `manual-only` is a degraded runtime fallback after site behavior changes; it is not a release-ready provider mode and does not pass acceptance.
- Preserve each created page's state while switching tabs during the current Translation session. Create a provider's WebContentsView only on its first activation; do not pre-create unopened providers. Explicitly destroy all provider views when the Translation window closes. Do not add LRU eviction, hibernation, TTL, or background recycling in this scope. Site-specific source-field selectors and trigger behavior belong to that website's descriptor/adapter, not to either native service category.
- Do not scrape and reformat every provider's rendered translation into the WebTools result pane. Website tabs, dedicated machine-translation APIs, and AI-provider results have distinct output ownership and execution routes.
- Do not silently fall back from a website that fails to load to a paid API request.

| Website provider | Catalog role | Initial declared behavior before site-specific runtime verification |
|---|---|---|
| Youdao | Proposed initial provider | Enable by default only after its provider-specific fill, trigger, and visible-result flow passes. If that flow later breaks, show a visible manual-input fallback and mark the provider degraded. |
| Google Translate | Proposed initial provider | Enable by default only after its provider-specific fill, trigger, and visible-result flow passes. If that flow later breaks, show a visible manual-input fallback and mark the provider degraded. |
| Microsoft/Bing | Proposed initial provider | Enable by default only after its provider-specific fill, trigger, and visible-result flow passes. If that flow later breaks, show a visible manual-input fallback and mark the provider degraded. |
| Tencent | Proposed initial provider | Enable by default only after its provider-specific fill, trigger, and visible-result flow passes. If that flow later breaks, show a visible manual-input fallback. Do not copy uTools' static space-key behavior without separate WebTools runtime evidence. |
| Sogou | Optional catalog candidate | Disabled until its provider-specific fill, trigger, and visible-result flow passes; manual entry is only a degraded runtime fallback. |
| DeepL | Optional catalog candidate | Disabled until its provider-specific fill, trigger, and visible-result flow passes; manual entry is only a degraded runtime fallback. |
| Caiyun | Optional catalog candidate | Disabled until its provider-specific fill, trigger, and visible-result flow passes; manual entry is only a degraded runtime fallback. |
| CNKI | Optional catalog candidate | Disabled until its provider-specific fill, trigger, and visible-result flow passes; manual entry is only a degraded runtime fallback. |

The values above are release rules, not claims about current live-site behavior. A provider is not marked supported or enabled by default until its automated flow has been verified. A text appearing in the field alone does not pass provider acceptance; a manual-only fallback after a runtime failure does not turn that provider into a passing release implementation.

Use Electron WebContentsView or another supported plugin-window primitive, with remote content isolated from HomePage preload APIs and API credentials. Electron currently advises against the webview tag because its stability and future availability are not guaranteed; HomePage's existing WebContentsView runtime is the closer implementation pattern. Integrate view creation and cleanup into the built-in Translation plugin's existing window and lifecycle.


### 4.2.1 Website session and browser defaults

Until a provider-specific security review approves more

- **Navigation:** HTTPS only. Keep the embedded view on the declared provider origin and explicitly reviewed HTTPS redirect origins. Block other in-view navigation; an external destination may open in the system browser only after a user gesture and clear destination indication.
- **Popups/new windows:** block by default. Do not create unowned BrowserWindows or WebContentsViews. A provider-specific exception must declare its destination and user-gesture policy before release.
- **Downloads:** cancel by default and show a visible explanation. No silent downloads. If a real provider workflow needs downloads, add an explicit user-confirmed save flow and review it before enabling.
- **Permissions:** deny by default, including camera, microphone, location, notifications, and file-system access. A requirement must be reviewed before any permission is granted.
- **Login and site data:** use a distinct ephemeral session per website provider, isolated from Manager, Plugin Windows, and other providers. Do not share WebTools credentials or cookies. Persistent login is not in this design; it requires a separate retention/clear-data decision before implementation.
- **Provider scripting:** source-field adapters are narrow, provider-specific, and limited to filling the source and any approved trigger. They cannot read WebTools secrets, access HomePage preload APIs, or turn arbitrary website content into an API result.


### 4.3 WebTools translation tab

`WebTools 翻译` is one peer tab alongside the hosted websites. It retains the native source text, source/target language controls, translation result, copy action, loading/error state, and explicit cancellation. Inside this tab, a service selector presents dedicated machine-translation API services and AI translation providers in separate groups labeled `机器翻译 API` and `AI 翻译`. Website tabs are not entries in this service selector. AI translation calls the existing `SharedAI.complete()` route with a translation prompt; no translation-specific capability field is added to the AI Provider Registry.

When Translation 2.0 opens with non-empty supplied text while `WebTools 翻译` is the selected tab, schedule one automatic translation using the existing 500 ms debounce and the currently selected provider, model, and language pair. The current open/content generation and text/settings signature suppress duplicate scheduling for the same open. Do not poll, periodically retry, or issue a second request because a result is slow. The existing manual Translate action remains available. If a website tab is selected, retain that provider page's own source-fill/trigger flow and do not call the native WebTools translator as a fallback.

The Legacy Capability Inventory & 2.0 Scope Review records the direct MyMemory path, platform Shared AI Translation path, specialized Qwen-MT path, languages, and provider settings as separate inventory entries. Each is marked retain, replace, or remove based on the 2.0 product scope; none is automatically a preservation obligation. This design schedules no Qwen-MT adapter work. If Qwen-MT is selected for retention, define its concrete route in the new plugin and the translation-specific service boundary it needs. Do not assume that SharedAI.complete() replaces MyMemory or Qwen-MT.


#### Native providers and user-imported API definitions

Keep four related provider/source routes distinct:

1. **Website translation pages:** remote website tabs such as DeepL website, Google Translate, or Microsoft/Bing. They own their page and result rendering, and do not use the native service selector.
2. **Dedicated machine-translation API adapters:** provider-specific translation services such as DeepL API, Google Cloud Translation, Microsoft Translator, MyMemory, and Qwen-MT. Each adapter owns its service-specific authentication, endpoint/region rules, language-code mapping, request/response contract, limits, cancellation, and errors. Qwen-MT is a specialized machine-translation capability; it is not a generic AI model provider merely because a model endpoint may be involved.
3. **AI Model Provider APIs:** LLM-based translation through the existing Shared AI / AI Provider Registry path. OpenAI-compatible Chat Completions is one possible protocol in this category, not the definition of all translation APIs. Translation calls existing `SharedAI.complete()` with a translation prompt and reuses existing provider IDs, models, credentials, and settings. AI providers do not need a new `translate` capability declaration; the selected AI service's ordinary text-completion path is the translation mechanism.
4. **Imported custom translation APIs:** user-imported, data-only API definitions for dedicated translation services not covered by a built-in adapter. The definition supplies supported request/response mapping and fields; it is consumed by the Translation plugin's own service request implementation. It is not a WebTools plugin package, has no executable handler, and does not add a separate capability or package lifecycle. Complex APIs outside the supported definition format require a specifically implemented adapter and are not claimed compatible merely because a URL can be entered.

The DeepL website tab and DeepL API adapter are different providers with different result ownership and security boundaries. The same website/API separation applies to Google and Microsoft/Bing.

The native selector may be one control, but it must show two explicit groups: `机器翻译 API` and `AI 翻译`. A direct machine-translation service instance is a named, user-configured instance of one approved dedicated adapter; its fields and test flow come from that adapter. An AI translation choice is an eligible provider/model selection from the existing Shared AI / AI Provider Registry settings and credential store, not a second Translation-owned service instance. Sharing Electron Main/SecretStore as the secure storage boundary does not merge the settings models or credential identities.

DeepL API is an explicit initial dedicated-API-adapter candidate, not a feature postponed to a later extensibility phase. The initial built-in direct-translation adapters and exact configuration fields are remaining product and implementation decisions. Google Cloud Translation and Microsoft Translator are also candidates; MyMemory is an inventory item to mark retain, replace, or remove. Shared AI Translation is assessed separately as an existing AI-provider route. Qwen-MT is likewise an inventory item, not a prerequisite for this product direction; no Qwen-MT adapter work is scheduled unless the scope review explicitly retains it.

| Provider / route | Design status | Details to define or verify |
|---|---|---|
| DeepL API | Explicit direct-translation API candidate for the initial release; distinct from the DeepL website tab. | Authentication, supported endpoint/region choices, language-code mapping, request/response contract, quotas/limits, and per-instance fields. |
| Google Cloud Translation | Direct-translation API candidate; not the Google Translate website tab. | Whether included initially and its credentials/project/region fields, language mapping, protocol, and limits. |
| Microsoft Translator | Direct-translation API candidate; not the Microsoft/Bing website tab. | Whether included initially and its key/region/endpoint fields, language mapping, protocol, and limits. |
| MyMemory | Existing direct path; a Legacy inventory item, not an automatic retention obligation. | Record retain/replace/remove and, if retained, its request, limits, error and configuration behavior. |
| Shared AI / AI Provider Registry | Existing AI translation route; belongs to the `AI 翻译` group, not the dedicated machine-translation API group. | List the providers already in the registry with their preset endpoints and provider-specific fields; reuse existing models, settings, and credential storage. Call `SharedAI.complete()` with a translation prompt; do not add a `translate` capability to the AI registry. |
| Qwen-MT | Existing specialized machine-translation path; a Legacy inventory item, not an automatic retention obligation. No adapter work is scheduled here. | Record retain/replace/remove and, only if retained, define its 2.0 implementation and required Translation-specific request path. |
| OpenAI-compatible Chat Completions | Required BYO AI translation path through the existing AI Provider Registry, not the universal custom translation API protocol. | Reuse existing endpoint/model configuration and credentials; call `SharedAI.complete()` with a translation prompt. No capability metadata change is required. |
| Imported custom translation API definition | Required BYO path for dedicated translation APIs not covered by a built-in adapter. | Define the bounded data-only request/response format, import/configure/test/select flow, endpoint review, and secret handling. No plugin manifest, executable handler, package permission lifecycle, or `translate` capability is added. |

The specific built-in provider catalog and first-release adapter list remain product-scope decisions; importing supported custom translation API definitions is required scope. “User-configurable service” means an instance of a supported built-in adapter or an imported data-only API definition; it does not mean users can invent an arbitrary protocol through a common service form.

For dedicated machine-translation APIs, service configuration follows a configure-test-save-select flow: choose a supported adapter type, enter a user-visible service name and that adapter's fields, run its explicit connection test, save the instance, then select it in the `机器翻译 API` group. Different instances may use the same adapter type where its contract permits. The UI identifies which provider receives each request. Credentials remain owned by Electron Main/SecretStore, with write/replace/remove behavior, masked display, and configured/missing status; saved keys are never returned to Renderer or website pages. A test warns that it may consume quota, uses bounded non-sensitive input, and does not log keys or source text. Endpoint, region, and model fields are shown only where the selected adapter requires them; a generic form must not imply that all protocols share `base URL + key + model` semantics.

For AI translation, list the built-in providers already exposed by the Shared AI / AI Provider Registry, with their known endpoint and provider-specific defaults. The current registry includes OpenAI, Anthropic Claude, Google Gemini, DeepSeek, and Qwen; users choose one and fill credentials plus any provider-required model, region, or workspace fields, without looking up a Base URL. Keep `Custom / OpenAI-compatible` as a separate option that asks for a Base URL. Reuse existing AI settings and credential storage; do not add a second Translation-owned AI configuration. AI translation uses `SharedAI.complete()` with a translation prompt; no provider capability declaration is required.

KISS Translator is a reference for separating service configuration from use: add a service, enter its API details, test/save it, then select it for translation. Its custom API guide shows a common request/response format and optional request/response hooks for unusual formats. Translation 2.0 keeps the import/configure/test/select flow but starts with data-only API definitions for supported request/response shapes. It does not import plugin packages or execute hook code; APIs requiring custom code, signing, polling, or transformations need a separately selected built-in adapter and are not implied to work through the generic definition format.

One selector may contain the two native service categories if the groups remain explicit and the selected route is unambiguous. Imported custom API definitions appear under `机器翻译 API` because they describe translation-only HTTP services. Selecting a website tab never invokes an API adapter. Selecting a machine-translation instance never loads a website or consumes AI-provider credentials; selecting an AI provider uses the existing AI Registry route and does not invoke a dedicated translation API adapter. Unconfigured instances show setup guidance; failures never trigger silent fallback between website, machine-translation API, and AI translation routes.


#### Service management experience

Translation 2.0 includes a service-management surface in its settings or provider-management view, not only a selector. Its service list shows each added service's display name, provider/type, enabled or hidden state in the selector, configured/test status, and whether it is the default for the WebTools translation scenario. Users can test, edit, show/enable, hide, set or clear the default, and delete a service instance. Multiple named instances of the same supported provider type are allowed when that adapter supports them. API credential input fields provide a show/hide control where applicable; saved credentials remain masked and are managed by the Host. AI entries remain tied to the existing AI Provider Registry and its credentials; the Translation service list must not create a duplicate AI credential store. Deleting a translation-specific instance removes that instance's configuration and secret references; it does not silently delete a shared AI provider used elsewhere. A restore-defaults action restores the built-in service visibility/order/default choices without deleting user-created instances or credentials.

“添加自定义翻译服务” in the new Translation 2.0 module opens a catalog/dialog with separate `AI 服务` and `专用机器翻译` groups. AI selections reuse existing AI Registry providers and credentials. Built-in machine-translation services show provider-specific fields; a custom translation API can be added by importing a data-only definition that describes a supported endpoint, authentication fields, request mapping, language mapping, and response extraction. The user enters secrets, tests, names (for example, `DeepL 1`), saves, and selects the service. The definition import does not install a plugin, run code, or introduce a manifest/permission/version lifecycle. The initial definition format must state which request/response patterns it supports; arbitrary protocols requiring executable hooks are outside this generic import path. Website tabs retain separate show/hide and ordering controls and do not appear as API service instances.

**BYO/custom API remains a required Translation 2.0 product capability.** It has two distinct paths: (a) configure an OpenAI-compatible LLM endpoint through the existing AI Provider Registry as an `AI 翻译` source; (b) import a data-only definition for a dedicated translation API whose request/response pattern is supported by the Translation plugin. The user supplies credentials, tests, names, saves, and selects the service. Imported definitions do not install plugins and do not execute code. Do not claim that a generic Base URL/Key/Model form works with every vendor protocol; if a provider requires behavior the definition format cannot express, it needs an explicitly supported provider adapter.

The custom API implementation is limited to the smallest data-only definition format needed for supported translation requests: endpoint and method, user-entered authentication fields, bounded header/body mappings, source/target language fields, and response text extraction. Translation requests run through the Translation feature's Main-owned request path, use the configured service endpoint, honor cancellation, and keep secrets out of Renderer and website pages. This is not a general plugin API, arbitrary HTTP/fetch capability, script runner, marketplace, permission-manifest system, or package-upgrade lifecycle. Unsupported complex protocols are not claimed compatible; add a provider-specific adapter only when that provider is selected for support.


#### Importable API definitions and request boundary

The user obtains or creates a supported data-only API definition, imports it in the built-in Translation plugin, reviews its provider name and endpoint, enters their own credentials, tests it, saves a named service instance, and selects it in `机器翻译 API`. The definition describes only fields and request/response mappings accepted by the Translation feature's schema. It is configuration data, not a WebTools plugin package or executable adapter.

The existing code does not provide arbitrary translation API execution from imported definitions. Implement only the Translation-specific Main request path needed for built-in adapters and the bounded imported-definition schema. Validate the definition and endpoint, bind each saved instance to its own config/secret references, show the endpoint before first use, restrict redirects to the configured service origin, bound request/response sizes and timeouts, and honor cancellation/stale-result guards. Do not add package manifests, translation capabilities to the Plugin Registry, user-supplied handlers, a script sandbox, a generic network broker, per-package authorization/versioning, or package upgrade/migration machinery for this feature.

If an API cannot be represented by the supported definition schema, do not silently treat it as compatible. Add a provider-specific adapter only after that provider is chosen for support; custom code execution and plugin-package import are not part of this Translation 2.0 design.


### 4.4 Entry and tab switching

- The 翻译 entry opens the built-in Translation 2.0 plugin window/surface. The packaged-review correction removes the Legacy Manager page/route; it is not a fallback.
- A supplied source string is handed to the active top-level tab. The WebTools tab follows the selected grouped native-service route; a website tab receives the source in the provider page only as part of the user's explicit Translation action. Make the external-site handoff clear; do not send text to a website merely because a panel was captured or matched.
- Before switching away from a website tab, read its latest source field value, including user edits, when the provider adapter can access it; update the plugin's canonical source text and send that newest value to the destination tab. If it cannot be read, send the last source value held by the app and show that the site edit could not be synchronized. The application-owned source remains available when returning from a website tab.
- Switching to the Google tab replaces the current primary external-Google action. An optional explicit “open this site in the system browser” action may remain in an overflow menu, but it is not the default provider path.
- The Super Panel's full `翻译` operation remains available whenever applicable, including while a separate Quick Result is loading, successful, empty, or failed. Activating it invalidates/cancels the Quick Result request and immediately opens or focuses the built-in Translation 2.0 plugin window with the exact captured text. Navigation must not wait for a provider response; late Quick Result output cannot replace the new surface or reappear in a later panel state.
- A same-panel Quick Result, if retained, is a distinct action and presentation from full Translation. It must not route through or depend on the Legacy Manager Translation page.

## 5. Provider and execution boundaries

Represent the top-level surface and the native translation-service choice separately. Keep the website, dedicated machine-translation API, and AI-provider routes explicit:

```ts
type TranslationSurfaceProvider =
  | { kind: 'website'; id: string; title: string; url: string; enabled: boolean; order: number }
  | { kind: 'webtools-translation'; id: 'webtools-translation'; title: string }

type WebToolsTranslationService =
  | { kind: 'machine-translation-api'; source: 'builtin' | 'imported-definition'; adapterType?: string; definitionId?: string; instanceId: string; title: string; configured: boolean }
  | { kind: 'ai-provider'; source: 'registry'; providerId: string; modelId?: string; title: string; configured: boolean }
```

This is illustrative, not a frozen TypeScript contract.

- `WebsiteProviderHost` owns a website view, load state, provider-specific source-field strategy, lazy creation, and explicit view cleanup.
- Dedicated machine-translation API requests use provider-specific adapters through the Translation feature's Main-owned request path.
- AI translation resolves provider/model selection and credentials through the existing Shared AI / AI Provider Registry path, then calls `SharedAI.complete()` with a translation prompt; do not create duplicate Translation-owned AI provider settings or add an AI `translate` capability.
- Imported custom API definitions are validated data used by the Translation-specific request implementation. They are not plugin packages and do not introduce a plugin manifest, capability registry, handler runtime, or package lifecycle.
- A website ID is not sent to a native translation service; a machine-translation adapter ID or AI provider ID is not passed as a website URL.
- Keep API keys in Electron Main's existing secret-storage boundary. Renderer settings may show configured/missing state but do not receive saved key values. Remote provider pages must never receive WebTools API keys.
- Imported service credentials are held in the existing Main/SecretStore boundary and are never returned to Renderer or website pages. The configured endpoint is shown before use; requests and redirects are restricted to its reviewed origin. Website provider sessions do not share API credentials.
- Missing direct-API configuration shows setup for that adapter instance; missing AI provider/model credentials link to or explain the existing AI settings state. No silent provider fallback or cross-category credential reuse.

## 6. Lifecycle and migration

Translation 2.0 is a replacement for the temporary Legacy Manager Translation implementation, not a 1:1 UI/route/engine migration. Following the packaged-review instruction, the Legacy Manager path is removed; shared and preview-used services/settings remain. The Legacy Capability Inventory & 2.0 Scope Review must mark each old capability as **retain**, **replace**, or **remove** and state the corresponding 2.0 behavior. MyMemory, Shared AI, Qwen-MT, language preferences, and provider settings are inventory entries only; none is automatically required to survive.

- API requests in the new surface use request IDs, cancellation, and stale-result guards. Leaving a tab, replacing the source, closing Translation 2.0, or disabling its owning feature must prevent an old result from overwriting newer state.
- The Super Panel full 翻译 operation invalidates/cancels a separate Quick Result request and hands the exact current selection to the built-in Translation 2.0 plugin window. It does not route through Legacy Manager Translation and remains available after Quick Result success, empty output, or error.
- Website views are lazy-created on first tab activation, retain their state while the Translation window remains open, and are explicitly destroyed when it closes. Do not pre-create unopened providers or add background eviction/hibernation machinery.
- Migrate only data explicitly marked retain in the inventory and mapped to a 2.0 setting. Define data conversion and user-visible handling; do not silently copy, reinterpret, or promise preservation of every legacy language, provider, engine, credential, or default setting.
- Imported API definitions and their named instances retain their definition identity and user configuration. Editing or replacing a definition is an explicit service-management action; there is no plugin package update, capability reauthorization, or package migration flow.
- Remove the old Manager Translation UI, gate/handoff, navigation route and Manager translation IPC under the user’s immediate-cutover instruction. Retain components deliberately adopted by 2.0 or still used by Super Panel preview/Shared AI. Do not delete existing user data as part of this correction.

## 7. Proposed delivery sequence


### Implementation basis

The Translation 2.0 plugin is the selected implementation: use the completed WebTools Plugin architecture. The provider list, website autofill/trigger matrix, native machine-translation/AI boundary, bounded custom API-definition format, security defaults, service-management flow, and acceptance scenarios are implementation work within this plugin. Add only translation-specific integration needed by the feature; no generic plugin-lifecycle project is required.


### Ordered delivery

1. **Legacy Capability Inventory & 2.0 Scope Review:** inventory old Manager Translation capabilities and mark each retain, replace, or remove. Explicitly state that 2.0 does not reproduce the old UI, route, or engine set one-for-one. Audit MyMemory, Shared AI, Qwen-MT, language preferences, and provider settings without treating any as automatic retention requirements. Define the initial built-in API list and provider-specific fields, custom API-definition schema, service list/catalog behavior, named instances, visibility/default/test/edit/delete behavior, AI Registry reuse, and website catalog/source-trigger/security policies.
2. **Built-in Translation 2.0 plugin and service management:** implement the plugin's own tab window/surface, the WebTools 翻译 native experience, and service-management list/catalog on the existing plugin architecture. Include named instances, enabled/hidden and default state, test/edit/delete, provider catalog groups AI 服务 and 专用机器翻译, provider-specific configuration fields, and multiple named instances where supported. AI provider/model entries reuse existing AI settings and credentials; dedicated API instances use their adapter schemas. Keep websites, dedicated machine-translation APIs, and AI-provider identities/results distinct.
3. **Built-in API and AI Provider routes:** implement the selected direct machine-translation adapters and the AI translation route through the existing AI Provider Registry. AI translation uses `SharedAI.complete()` with a translation prompt; do not add a `translate` capability to AI providers. Use provider-specific authentication/configuration and preserve cancellation/error behavior. Do not add a parallel AI credential registry.
4. **Website provider pages and reference flow:** keep Google as the current source-handoff reference; allow every declared provider page to be shown/hidden/reordered without a verification-status gate. Record actual automatic-input/visible-result verification per site. Keep isolated sessions, navigation restrictions and popup/download/permission denial.
5. **Imported custom API-definition flow:** deliver import/configure/test/select for data-only definitions that use the supported request/response schema. The user reviews the endpoint, enters their API fields/secrets, creates a named instance, tests, saves, and selects it without writing code. The definition format does not run scripts or install plugin packages. Protocols it cannot express require a separately selected provider-specific adapter; do not promise universal API compatibility. OpenAI-compatible AI translation remains configured through the existing AI Provider Registry.
6. **Scoped migration and Legacy removal:** migrate only capabilities and data marked retain in the reviewed inventory. The packaged-review instruction removes Legacy Manager Translation UI, route, view and its IPC/handoff directly. Retain only shared/preview-used code; do not delete user data. Keep only code intentionally adopted by Translation 2.0 or demonstrably shared.

The website catalog and provider strategy matrix can be prepared as feature work; the plugin's tab runtime foundation uses the already completed plugin architecture. API acceptance must list exact supported built-in adapter types and their configuration schemas, plus the existing-registry AI route and imported data-only custom API path for supported request/response shapes. The inventory records any old capability intentionally removed or replaced; there is no requirement to reproduce every old capability one-for-one.

## 8. Design acceptance criteria

- Website providers and `WebTools 翻译` appear as peer tabs in the built-in Translation 2.0 plugin window/surface, outside Manager.
- Website provider visibility and order can be changed and persist after closing/reopening the surface.
- Website provider views are created only on first activation and explicitly destroyed when the Translation window closes; unopened providers do not allocate WebContentsViews.
- Opening Translation with text activates the selected provider and hands it the source text.
- Opening with non-empty text on the selected `WebTools 翻译` tab automatically translates once after the existing 500 ms debounce. Duplicate open events for the same generation do not issue duplicate requests; there is no polling or periodic retry. A selected website tab continues to use its own page flow.
- Translation 2.0 opens in its own built-in plugin window/surface, not in Manager. While a same-panel Quick Result is loading, clicking the Super Panel full 翻译 operation cancels/invalidates that request and immediately opens or routes to the Translation 2.0 plugin with the exact source text. The same behavior applies after preview success, empty output, or error; it never routes through the Legacy Manager page.
- The Super Panel `翻译` operation remains available after a preview succeeds and is not removed as a side effect of displaying the result.
- Every declared website can be shown, hidden and reordered as a website tab. Record source-fill/trigger support separately from page availability. A selectable tab does not claim verified automatic translation; if automatic input fails, show a visible fallback and let the user operate the page. Do not silently fall back to an API.
- Switching away from a website tab reads the most recently edited source field when accessible and sends that value to the next provider tab. If it cannot be read, the plugin uses its last known source value and tells the user the site edit could not be synchronized.
- Website navigation stays within the provider's declared HTTPS origin set; popups and downloads are blocked by default; permissions are denied by default; each provider has isolated ephemeral site data and no shared WebTools credentials. Any exception requires a reviewed provider-specific decision.
- A website tab renders and remains interactive as the provider's own page; it does not scrape or claim a normalized WebTools API result. Website failure never silently sends the source to an API.
- The WebTools tab visibly groups choices into `机器翻译 API` and `AI 翻译` (a single grouped selector is allowed). Direct API choices use their own adapter/instance contracts; AI Registry choices reuse existing provider/model settings and credentials and call `SharedAI.complete()` with a translation prompt. Neither category invokes website pages, and failure in one category never silently falls back to another.
- The AI service catalog lists the providers already available in Shared AI (currently OpenAI, Anthropic Claude, Google Gemini, DeepSeek, and Qwen) with preset endpoints and provider-specific fields. Selecting a built-in provider does not ask the user to look up a Base URL; `Custom / OpenAI-compatible` remains a separate option that does.
- The new Translation 2.0 service-management surface lists each configured instance by name/type and shows enabled/hidden, configured/test status, and default status. Users can test, edit, enable/show, hide, set or clear the default, and delete instances; multiple named instances of one adapter type work where supported. Restore-defaults restores built-in visibility/order/default choices without deleting user-created services or credentials.
- “添加自定义翻译服务” opens a catalog grouped into `AI 服务` and `专用机器翻译`. Selecting a type shows its appropriate provider-specific fields; users can name an instance (for example, `DeepL 1`), enter credentials with a show/hide control during entry where applicable, test, save, and select/use it in Translation 2.0. Users import data-only custom API definitions through this new plugin surface, never through Legacy Manager. The format validates supported request/response patterns and does not execute code.
- At least one dedicated machine-translation API selected for the initial release and one AI Provider must pass their own route. For each, verify its request/response contract, cancellation, visible error handling, and that the user's selected provider/model/instance is the one actually invoked. AI translation uses the existing AI Provider Registry and `SharedAI.complete()` with a translation prompt; no `translate` capability declaration is added.
- An ordinary user can import a supported custom translation API definition, review its endpoint, enter their own configuration/secret fields, test, name, save, and select it without writing code. Verify the supported request/response mappings, cancellation, visible errors, endpoint-origin restrictions, and secret isolation. Unsupported custom protocols are clearly identified and are not treated as compatible based on URL/key/model alone.
- The Legacy Capability Inventory & 2.0 Scope Review marks each old capability retain, replace, or remove. Migration handles only retained data with an explicit mapping; it does not mix credentials between AI and dedicated machine-translation categories. The old UI, route, and engine set are not reproduced one-for-one by default.
- The API catalog definition lists a concrete initial built-in adapter set and per-adapter configuration schema. DeepL API is evaluated as a direct translation API candidate distinct from the DeepL website tab; Google Cloud Translation and Microsoft Translator remain candidates until selected.
- A user can create named service instances for supported dedicated machine-translation adapters, provide the fields that adapter requires, test and save multiple instances, and select a configured instance in the `机器翻译 API` group. AI choices instead come from existing AI provider/model settings in the `AI 翻译` group. The selected destination is clear, and secrets stay in Main/SecretStore rather than Renderer or website pages.
- OpenAI-compatible Chat Completions is one BYO AI translation path through the existing AI Provider Registry; it is not the universal definition of a custom translation API.
- A generic endpoint/key/model form is never represented as compatible with every API. User-imported custom translation APIs use the supported data-only definition schema; no plugin package, capability, arbitrary handler, or package authorization/upgrade system is part of this design.
- The Legacy Capability Inventory & 2.0 Scope Review accounts for old paths/settings and records retain, replace, or remove; Qwen-MT is one inventory item and is not automatically required. If retained, its 2.0 implementation is explicitly designed.
- Google Translate website and Google Cloud Translation API are distinct choices with clear names.
- The existing `翻译` entry opens the built-in Translation 2.0 plugin window/surface. Legacy Manager Translation UI, route, view and handoff/translation IPC are removed under the packaged-review instruction; only deliberately adopted, shared or preview-used functionality remains.
- An online service-comparison view is outside the currently approved Translation 2.0 scope.

## 9. Remaining implementation decisions

1. **Legacy Capability Inventory & 2.0 Scope Review:** record each old feature/setting/path as retain, replace, or remove and define user-visible data handling for retained items. Reproducing the old capability set one-for-one is not a goal. MyMemory, Shared AI, Qwen-MT, languages, and provider settings are inventory items; none is an automatic requirement.
2. **Initial built-in API catalog and service-management details:** decide which dedicated translation APIs ship first and each one's fields/authentication/endpoint/region/language mapping/request/response/limits. DeepL API is an explicit candidate distinct from its website tab; Google Cloud Translation and Microsoft Translator are candidates. Define the data-only import format and its supported request/response shapes, service instance list/catalog behavior, provider-specific forms, default/visibility state, test/edit/delete, restore defaults, and AI Registry reuse. OpenAI-compatible AI translation and imported custom translation API definitions remain required BYO paths.
3. **Custom API definition validation and request handling:** define the bounded data schema, supported authentication options, request/body and response mappings, endpoint display/confirmation, Main-owned secret storage, cancellation, timeout, response-size, and redirect rules. Do not introduce executable handlers, package manifests, a second package lifecycle, plugin capability declarations, or a generic network extension system.
4. **Website catalog and strategies:** record each site’s source-field and trigger support against its live page. Provider page controls stay available; unavailable sites or failed automated input show explicit error/fallback states. Do not infer successful translation from a tab existing or a field being filled.
5. **Website security/session exceptions:** the defaults in §4.2.1 are deny-by-default. Persistent login, non-provider navigation, popups, downloads, or permissions require provider-specific approval before implementation; they cannot be inferred from the uTools package.

## 10. References

- Store this project's translation-analysis, reverse-engineering, and test evidence under `D:\SystemDefault\Desktop\webtoolstest`; do not place it in the C-drive user cache.
- uTools installed plugin evidence: `D:\SystemDefault\Desktop\webtoolstest\utools-translation-analysis-20261018\utools-translatehub-plugin.json`, `utools-translatehub-preload.js`, and `utools-translatehub-index.js`.
- uTools full REA evidence export: `D:\SystemDefault\Desktop\webtoolstest\utools-translation-analysis-20261018\utools-app-analysis-20261018.json`.
- HomePage's previous Translation 2.0 plan: `docs/superpowers/plans/2026-09-27-translation-module-2.0.md`.
- KISS Translator service configuration and adapter catalog reference: <https://github.com/fishjar/kiss-translator/blob/dev/README.md>.
- KISS Translator custom API request/response hook reference: <https://github.com/fishjar/kiss-translator/blob/dev/custom-api_v2.md>.
- KISS Translator plugin guide (reviewed as a comparison only; its plugin package/handler system is not part of this design): <https://github.com/fishjar/kiss-translator/blob/dev/docs/plugins/plugin-development-guide.md>.
- Electron WebContentsView: <https://www.electronjs.org/docs/latest/api/web-contents-view>.
- Electron warning about `<webview>`: <https://www.electronjs.org/docs/latest/api/webview-tag>.
