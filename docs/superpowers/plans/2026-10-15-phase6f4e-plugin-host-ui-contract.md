# Phase 6F-4E — Plugin Host/UI Experience Contract Implementation Plan

> **For agentic workers:** Implement this plan only after the user approves it. Use the `superpowers:executing-plans` skill and complete the tasks in order. This document is a plan, not authorization to implement, test, package, or commit.

**Goal:** Give Web Plugin Windows a stable, optional theme contract that follows the saved WebTools theme preference while preserving plugin-owned layout, framework choice, and runtime authority boundaries.

**Architecture:** Electron Main resolves the current saved theme and the Windows theme signal. It provides semantic CSS custom properties to the existing `WebContentsView` through Main-owned `webContents.insertCSS`, before the Plugin Window becomes visible and whenever the effective theme changes. This is an opt-in color-semantic bridge, not a shared component or layout system. The Host owns the platform surfaces and native window shell; each plugin owns its content page and chooses whether to consume the properties. Pages that do not consume them keep their existing styling, which may look different from WebTools platform UI or other plugins. Do not change global `nativeTheme.themeSource` as a shortcut: explicit WebTools themes affect the plugin contract, while `system` resolves through Electron's Windows theme signal.

**Tech Stack:** Electron Main, `nativeTheme`, `BrowserWindow`, `WebContentsView`, TypeScript, existing plugin runtime test harness, pnpm, Markdown.

**Specification:** `docs/phase6f-plugin-platform-roadmap-after-utools-analysis.md` §I; `docs/phase6f4-manager-platform-architecture.md`; current Web Plugin Runtime 2.0 contracts.

**Approved decisions:** The user approved the recommended direction: follow the persisted light/dark/system preference; follow Windows live in system mode; publish optional `--webtools-*` semantic CSS properties and a `color-scheme` value; keep the current NativeHost/Electron architecture and plugin-authored UI; defer SDK helpers and tarball work to Phase 6F-5.

## Scope and boundaries

- This is Phase 6F-4E only. Do not start Phase 6F-5 or 6G.
- Preserve FeatureRef, Manifest, Window/Command, validated package snapshots, WebContentsView isolation, plugin Session, capabilities, and runtime authority.
- Do not add plugin APIs, preload/IPC routes, permissions, Manifest fields, an SDK/UI package, or a new runtime.
- Do not rewrite plugin DOM, inject page/component styles, force a page layout, or require all plugins to adopt the tokens. The only Host-injected selector allowed is `:root`, and it may contain only the approved custom-property declarations listed below.
- Do not redesign Manager, modify NativeHost, or change plugin business UI/IA.
- Do not modify SDK source/version, creator templates, tarballs, Feature activation, package validation policy, data/config schemas, or user data.
- Keep all generated fixtures, profiles, packaged output, logs, and evidence outside the repository and outside production `%APPDATA%\Nook`.
- The current checkout already contains unrelated and pre-existing modifications. Preserve them; do not reset, clean, stash, or stage broad paths. This plan alone does not authorize a commit or push.

## Contract to freeze

### UI consistency responsibility and guarantees

WebTools guarantees consistency only for surfaces that WebTools renders or directly controls:

- The Launcher search box, search result list, and plugin/Feature launch entries are Host-rendered platform UI. Their layout, result-row presentation, and platform interactions remain under WebTools ownership.
- The independent Plugin Window's native shell is Host-owned: title/icon, outer background, bounds/resizability, focus/show, reuse, keyboard/window lifecycle, and close behavior follow one platform contract.
- Plugin Center, permission/configuration management, and other Host-rendered declarative surfaces use WebTools UI.

After a Manifest v3 Web Feature opens, its content page is the plugin's own HTML/CSS/JavaScript application rendered by the existing WebContentsView. The plugin author owns that page's layout, spacing, typography, buttons, forms, icons, navigation, and page-level accessibility. The Host theme variables only make color roles and the resolved theme available; they do not make these components or layouts look alike.

If a plugin does not reference any `--webtools-*` variable, it still loads and runs with its existing/plugin-authored styles. The Host does not restyle it. Its page may therefore differ in color, controls, density, and accessibility from WebTools platform UI and from other plugins. This backward-compatibility promise is **not** a visual-consistency guarantee.

Strictly uniform content UI requires a Host-rendered page (as with the existing declarative compatibility surfaces), or a separately designed and explicitly adopted SDK/UI component contract. A mandatory UI kit, plugin migration, shared component package, or forced restyling is a later product decision and is outside 6F-4E.

### uTools reference and evidence limits

Use the following evidence levels; do not turn an inference into a claim about implementation:

1. **Official documentation:** uTools describes a plugin as a Web front end plus a preload bridge and Runtime. The front end is responsible for page rendering and interactions, can use React/Vue, and runs in a Host-managed BrowserView. Its `plugin.json` document describes plugin metadata and feature entry declarations; the reviewed schema does not define a mandatory shared component library or universal page stylesheet. The system API exposes `isDarkColors()` and recommends `prefers-color-scheme` with a change listener for plugin theme adaptation. The custom-window API exposes window `backgroundColor` and `webContents.insertCSS()` / `removeInsertedCSS()` capabilities. Those APIs document available operations, not a policy that all plugin pages must receive the same CSS or a separate CSS permission system.
2. **Local uTools 7.8.0 static ASAR evidence:** the reviewed, hashed `app.asar` excerpts show Host-side plugin metadata/search/entry routing and plugin WebViews. The plugin-platform parser excerpt copies a string `backgroundColor` field into parsed metadata; that excerpt alone does not establish where or whether the value is applied. A separate `initVoiceWindow` excerpt injects `.voice-panel` / `.define-font` rules into the Super Panel window, and a selected `loadFile` utility-window path injects a body font rule. These are specific window paths, not evidence that uTools globally injects styles into every plugin page. The evidence is from the locally installed 7.8.0 ASAR described by the analysis files, not from the installer PE.
3. **Design inference for WebTools:** uTools' search and launch experience gets its consistent appearance mainly from Host-rendered platform surfaces; plugin content pages retain developer HTML/CSS control. This is the architecture lesson for 6F-4E, not a claim that uTools has no other private styling behavior.

The local analysis says the currently open `uTools-7.8.0.exe` in IDA is an installer/bootstrapper; it is not evidence of plugin-page CSS behavior. Do not attribute an ASAR observation to that PE, and do not claim the PE was used to verify plugin CSS.

References:

- Local static comparison: `D:\SystemDefault\Desktop\rea\uTools-7.8.0-analysis\analysis\plugin_platform_comparison.md` §§2, 4.2, 5.2, 8; `D:\SystemDefault\Desktop\rea\uTools-7.8.0-analysis\analysis\features\plugin_platform.md`; `D:\SystemDefault\Desktop\rea\uTools-7.8.0-analysis\evidence\app_asar_feature_excerpts.json`.
- Official [plugin architecture](https://next.u-tools.cn/docs/development/plugin-architecture.html), [plugin.json](https://next.u-tools.cn/docs/development/plugin-json.html), [system theme API](https://next.u-tools.cn/docs/api-reference/system.html), and [custom-window API](https://next.u-tools.cn/docs/api-reference/window.html).

### Theme source and resolution

Use the persisted `AppSettings.theme` preference (`light`, `dark`, or `system`) as the source of truth. The existing default is `dark`.

- `light` resolves to the light semantic palette.
- `dark` resolves to the dark semantic palette.
- `system` resolves from `nativeTheme.shouldUseDarkColors` and follows `nativeTheme`'s `updated` event while a Plugin Window is open.
- A saved preference change updates open Plugin Windows after the setting is successfully accepted/persisted by the existing settings owner.
- Do not change the application-wide `nativeTheme.themeSource`; do not let this feature alter Manager theme behavior or Windows appearance settings.
- Expose the resolved `color-scheme` value (`light` or `dark`) so opted-in plugin pages can correctly render native form controls.

### Optional CSS properties and exact injection scope

Freeze these semantic names for 6F-4E. The Host's generated `insertCSS()` payload may contain exactly one rule with the `:root` selector and only these custom-property declarations. `:root` is the one allowed declaration scope because custom properties need a scope. No `html`, `body`, universal, class, ID, or other selector is allowed in Host CSS. No page-level `color`, `background`, font, control, layout, component, or animation rule is injected.

| Property | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `--webtools-color-scheme` | `light` | `dark` | A custom-property value describing the resolved scheme. It does **not** itself set the CSS `color-scheme` property or change native form controls. |
| `--webtools-color-background` | `#f3f5f8` | `#0b0c0e` | Main page/canvas background (`--canvas`). |
| `--webtools-color-surface` | `#ffffff` | `#18191b` | Primary contained surface (`--surface`). |
| `--webtools-color-surface-raised` | `#f7f9fb` | `#202124` | Raised or secondary surface. |
| `--webtools-color-text` | `#1b2633` | `#f4f4f5` | Primary text. |
| `--webtools-color-muted` | `#5f6f80` | `#a1a1aa` | Secondary text. |
| `--webtools-color-border` | `#e5eaf0` | `#303237` | Subtle separator/border (`--manager-border`). |
| `--webtools-color-accent` | `#2477f3` | `#91baff` | Action/accent (`--manager-action`). |
| `--webtools-color-accent-foreground` | `#ffffff` | `#111b2c` | Foreground suitable for the accent (`--manager-action-ink`). |

These values come from the existing Manager semantic palette in `src/styles/tokens.css`; implementation review must confirm readable contrast before freezing the report. They are semantic color values, not a shared component library. They can help an opted-in plugin align its own color roles. They cannot unify layout, spacing, typography, component appearance, icons, or accessibility. Do not export layout, spacing, radius, typography, shadows, or component-specific tokens in this phase.

The Host injection itself is limited to the `:root` custom-property rule. A plugin must explicitly consume a variable to get an effect. In particular, `--webtools-color-scheme` has no browser behavior until plugin CSS assigns it to the actual `color-scheme` property. An opted-in page can use:

```css
:root {
  color-scheme: var(--webtools-color-scheme, light dark);
  --page-background: var(--webtools-color-background, #fff);
  --page-text: var(--webtools-color-text, #1b2633);
}

body { color: var(--page-text); background: var(--page-background); }
```

The `body` rule above is plugin-authored CSS, not Host injection. The contract documents fallback behavior for a page running without WebTools-provided values. For a page that must follow the **effective WebTools theme** (including a saved light/dark override), use the injected variable; `prefers-color-scheme` reflects the runtime's system color preference and should only be used when the plugin intentionally wants that system signal. In WebTools `system` mode, the Host resolves the Windows theme and updates the variables while the Plugin Window is open.

### Host shell and plugin responsibility

- Host: search/launch surfaces; Plugin Center and Host-rendered declarative UI; BrowserWindow title/icon and outer background; initial/minimum bounds; resizability; reuse; focus/show; keyboard/window lifecycle; and close behavior.
- Plugin: content-page HTML/CSS/JS; business layout and navigation; component behavior; semantic markup and accessible names; page focus order; and contrast of plugin-owned colors.
- The Host does not claim that token availability alone makes a plugin accessible. Document keyboard and accessibility expectations for plugin authors.
- A no-token plugin keeps its appearance but is not promised to match Host chrome, Launcher, Manager, or other plugin pages.

## Implementation tasks

### Task 1 — Add the pure theme contract and palette resolver

**Files:**

- Add `electron/plugins/plugin-window-theme.ts`.
- Add `electron/plugins/plugin-window-theme.test.mjs` using the repository's existing TypeScript test loading convention.

**Work:**

1. Define a closed resolved-theme type and a pure resolver from `ThemePreference` plus the system dark/light signal.
2. Define a single palette table for the frozen token names; keep the table derived from current Manager semantic colors, not copied component CSS.
3. Generate deterministic CSS in the exact form `:root { --webtools-...: <allowlisted literal>; ... }`. This is the only Host-injected selector and it contains only allowlisted custom-property assignments. Do not inject a `color-scheme` property; the `--webtools-color-scheme` custom property is inert until plugin-authored CSS consumes it. Accept no plugin-provided CSS, selector, URL, or arbitrary color input.
4. Export the resolved `color-scheme` value and native window background value from the same resolved object so window chrome and page tokens cannot disagree.

**Tests:** explicit light/dark mapping; system light/dark mapping; valid custom `--webtools-color-scheme` value; every frozen token appears exactly once; generated CSS has exactly one `:root` rule and only approved custom-property declarations; no page-level `color-scheme`, element styles, settings, or secret values enter the output.

**Done when:** this module has no Electron side effects and its test covers the complete frozen token contract.

### Task 2 — Connect saved settings and Windows theme changes

**Files:**

- Add or extend a narrow Main-owned theme state/controller module under `electron/plugins/`.
- Update `electron/main.ts` to create and dispose the controller with the Electron Host lifecycle.
- Update `electron/ipc/settings-handlers.ts` only at the existing successful settings persistence seam, if a notification is required.
- Add focused tests for the controller/settings notification path.

**Work:**

1. Read the effective setting through the current settings owner, including the NativeHost-managed settings mirror; do not introduce a second persisted theme setting.
2. Subscribe to Electron `nativeTheme.updated`; emit a new resolved theme only when `system` mode changes its resolved appearance.
3. Notify the theme state after a successful saved theme update. Failed/rolled-back settings writes must not publish an uncommitted preference.
4. Remove listeners during app shutdown. Do not touch registry, startup settings, profiles, or NativeHost.
5. Keep Manager's existing renderer-owned `applyTheme()` behavior unchanged.

**Tests:** default preference; light/dark setting changes; system OS changes; no event for irrelevant OS changes under explicit light/dark; persistence failure does not update Plugin Windows; NativeHost-managed settings mirror is respected; listener disposal.

**Done when:** Main has one observable effective theme source and no parallel theme persistence path.

### Task 3 — Apply theme properties to the existing Web Plugin Runtime

**Files:**

- Update `electron/plugins/web-plugin-runtime.ts`.
- Update `electron/plugins/web-plugin-runtime.test.mjs`.
- Add a focused helper/test only if the current test harness cannot exercise CSS insertion without a product abstraction change.

**Work:**

1. Inject the generated variables with `webContents.insertCSS`; do not add preload methods, bridge routes, DOM mutation, or plugin-controlled style input.
2. Apply the initial style to the loaded runtime before publishing Runtime `READY` and before `PluginWindowManager` shows/focuses the window. Keep the BrowserWindow hidden until the existing readiness lifecycle completes.
3. On theme change, serialize replacement for the current `WebContentsView`: install new CSS, then remove the previous insertion key. Guard asynchronous completion with the existing runtime identity/generation and destroyed/closing checks.
4. On close, revocation, package reload, or WebContents destruction, remove the active insertion and discard pending replacements. A stale runtime must never restyle a newer generation.
5. Theme CSS is optional presentation. If initial injection fails, record a sanitized non-secret diagnostic and allow the runtime to become READY using the plugin's fallback styles. If a live replacement fails, retain the previous style and keep the runtime active. Do not grant theme failure any new plugin authority or leave an unhandled rejected promise.

**Tests:** initial CSS precedes READY; light/dark/system update affects the live page; same runtime only; stale-generation update is ignored; close/reload removes CSS; destroyed contents do not throw; no new bridge or capability; existing runtime security and lifecycle tests remain valid.

**Done when:** theme is presentation-only, generation-bound, and installed before first visible frame.

### Task 4 — Synchronize the native window shell without changing its behavior

**Files:**

- Update `electron/plugins/plugin-window-manager.ts`.
- Add `electron/plugins/plugin-window-manager.test.mjs` if no current focused test covers window reuse and theme updates.
- Wire the resolved theme subscription from `electron/main.ts`.

**Work:**

1. Create each BrowserWindow with the resolved background color instead of the fixed dark constant.
2. Update existing Plugin Window background color when effective theme changes, and forward the same resolved theme to its active runtime.
3. Keep current Feature identity key, one-window reuse, dimensions, focus/show, readiness ordering, close behavior, and surface accounting unchanged.
4. Apply the current theme when opening or reusing a window so a setting change during an in-flight load cannot leave a stale palette.

**Tests:** initial light/dark/system shell color; update on an open/reused window; only one BrowserWindow per existing identity; no change to bounds/title/icon/focus/close and `hasSurfaces` lifecycle.

**Done when:** window shell and opted-in page variables always use the same resolved theme without changing window ownership semantics.

### Task 5 — Document the Host/UI contract and framework examples

**Files:**

- Add `docs/plugin-window-theme-contract.md`.
- Update `docs/plugin-runtime.md` with a short link and compatibility summary.

**Work:**

Document:

- saved light/dark/system source and live Windows system updates;
- exact token names, meanings, palette, and fallback behavior;
- the Host/platform surfaces guaranteed to be consistent versus content pages controlled by plugin authors;
- opt-in usage examples for Vanilla, Vue, React, and Svelte using ordinary CSS imports (no SDK helper), including explicit consumption of `--webtools-color-scheme` when native controls should follow WebTools;
- existing pages with no tokens remain valid and retain plugin-owned appearance, while explicitly warning that they are not guaranteed to visually match the Host or other plugins;
- `prefers-color-scheme` as a system-theme signal versus the injected effective WebTools theme variable when the user has selected an explicit light/dark override;
- the exact allowed Host injection form (`:root` custom properties only), and the fact that a custom property named `--webtools-color-scheme` does not automatically change the CSS `color-scheme` property;
- Host shell versus plugin-owned UI/accessibility responsibilities;
- the timing guarantee that the initial theme is present before the Host reveals the window;
- current limitations and deferred SDK synchronization in 6F-5.

Do not change the SDK README, source, package version, creator templates, or produce a tarball.

**Done when:** an external plugin author can adopt the contract without importing a private WebTools module or changing runtime permissions.

### Task 6 — Add isolated cross-framework packaged acceptance

**Files:**

- Extend `scripts/verify-plugin-runtime-packaged.mjs` only if its existing isolation and cleanup guarantees are confirmed to cover this acceptance; otherwise add `scripts/verify-phase6f4e-plugin-theme.mjs`.
- Add test fixtures only under a temporary directory at runtime; do not commit generated `.wtplugin` files, profiles, screenshots, or package output.

**Work:**

1. Use the real packaged WebTools Electron Host, authoritative Host validator, real validated Manifest v3 packages, and production `WebContentsView` runtime.
2. Build external temporary Vanilla, Vue, React, and Svelte test pages that explicitly consume the color variables. Add a separate legacy/no-token compatibility page with its own fixed colors and component styles. Use only existing supported development tooling; do not modify SDK or creator contracts.
3. Give the test Host an isolated user-data path, named-pipe identity, app identity, and runtime directory. Validate executable path, PID, and creation time before cleanup; never connect to production NativeHost or touch `D:\webtools` / `%APPDATA%\Nook`.
4. Verify saved light↔dark changes on an open token-consuming Plugin Window, initial theme before first visible frame, and system-mode signal propagation. For the no-token page, verify its plugin-authored computed colors/layout remain unchanged across Host theme changes; do not require it to match WebTools or other plugins. Also verify window reuse/close/reopen.
5. Verify at one narrow and one wide size and at a second display scale when available; assert the Host does not rewrite plugin content or alter focus/keyboard behavior.
6. Use mocks only for deterministic unit tests. Packaged acceptance must run the actual validated packages through Host authority and production runtime.
7. Make cleanup bounded and identity-scoped. On timeout or interruption, terminate only authenticated test processes and preserve sanitized evidence outside the repository.

**Manual Windows acceptance:** Do not programmatically change the user's Windows personalization settings. Ask the user to switch the Windows app mode once while WebTools is set to `system`; record whether an open opted-in page updates without reopening. Also check an unthemed page, ordinary keyboard/window controls, resize, and close/reopen.

**Done when:** all four framework examples build and run through Host validation; opted-in pages can follow light/dark/system by consuming the variables; the no-token page keeps its own styling and remains functional without a visual-parity guarantee; Host platform UI and window shell behavior remain consistent; no production profile or installation is touched.

### Task 7 — Regression, report, and phase decision

**Regression commands (after implementation):**

```powershell
pnpm test
pnpm run typecheck
pnpm run build
pnpm run acceptance:plugin-runtime
```

If Task 6 requires a separate runner, document and run its exact command as well. For packaged verification, use the existing isolated/unpacked acceptance route and place all output under a disposable directory outside the repository; do not run the production installer or overwrite an installation.

**Files:** add `docs/phase6f4e-plugin-host-ui-contract.md` as the evidence report after implementation and acceptance.

Record source/build identity, the frozen token contract, theme update evidence, four-framework matrix, no-token compatibility, window/lifecycle checks, automated regression results, the user-confirmed Windows system-theme result, limitations, and P0/P1/P2/P3 findings. Do not call manual checks automated or claim success for unobserved cases.

**Phase close criteria:**

- Saved light/dark/system theme source is observable and live system mode follows Windows.
- Initial theme is applied before first visible Plugin Window frame.
- All injected custom-property values match the selected effective theme; an opted-in page demonstrates that assigning `--webtools-color-scheme` to the actual `color-scheme` property updates native controls.
- The four framework examples can opt into the color contract; the no-token compatibility page retains its own rendering. Acceptance does not require plugin content pages to share layouts, controls, icons, or overall visual appearance.
- Host-rendered search/launch/platform surfaces and the Plugin Window shell remain under Host ownership; plugin content layout and components remain author-owned.
- Window shell, size, focus, reuse, close, runtime authority, and security behavior remain intact.
- Required regression passes; user completes the real Windows system-theme check.
- P0 = 0, P1 = 0, and no blocking P2.

Only then record `PHASE 6F-4E COMPLETE` and `READY FOR PHASE 6F-5`. Do not begin 6F-5 in this task.

## Review risks and decisions to preserve

1. **First-frame ordering:** a theme mismatch can flash before the runtime is revealed. Initial token insertion must be part of the existing READY gate, not a delayed post-show update.
2. **Unstyled compatibility:** Host injection is exactly one `:root` rule containing approved custom properties. `:root` is allowed as the necessary declaration scope; no other selector or page rule is allowed. A plugin opts in by referencing variables in its own CSS. `--webtools-color-scheme` alone does not change native controls.
3. **System theme ownership:** listen to Electron's system signal; do not write the Windows personalization setting or repurpose Manager renderer state.
4. **Race safety:** settings changes, OS changes, package reload, close, and runtime generation replacement can overlap. Every asynchronous update must be tied to the current runtime identity/generation.
5. **Scope:** no SDK helper/tarball, shared component library, forced visual redesign, Manager redesign, security relaxation, or unrelated cleanup.
6. **Repository state:** before implementation, inventory the existing dirty tree and ensure the new work does not overwrite or stage unrelated Phase 6E/Launcher work. Do not silently declare the broader dirty tree part of this phase.
