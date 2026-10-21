# Native Super Panel

Current source update (2026-10-21): Quick Result and optional translation preview are implemented; full Translation 2.0 opens its own Electron window from the same action list. The Phase 6G-2 paragraph below records the earlier stage boundary. Its references to Manager translation and unimplemented preview are historical, superseded by the [consolidated checkpoint](2026-10-21-platform-consolidation.md) and [6G-3 report](phase6g3-super-panel-translation-preview.md). Session prewarm begins only after the WPF panel first frame; matching itself still does not execute plugin code.

## Phase 6G-2 selected-text actions

The approved first content rule is the optional `http-url` enum on a Manifest v3 selected-text-only accepted context. NativeHost evaluates it locally against the transient bounded selection; projection/cache and diagnostic snapshots carry only metadata, counts and offsets. It is a URL-shape filter, not full IDNA/DNS validation. Main rechecks the rule and live authority only after explicit activation. No-rule Translation and generic text actions remain applicable to ordinary selected text, including Chinese and mixed text. Empty/no selection keeps the existing shortcut board.

Following the 2026-10-17 product adjustment, the NativeHost itself supplies `搜索选中文字` for every valid selected-text context and `打开选中链接` for a matching complete HTTP(S) URL. These rows are placed before projected Features in the same action list and run only after an explicit click. Search reads the current Launcher search-engine snapshot at activation time; opening a link repeats the bounded HTTP(S) check and uses the existing shell URL validation. Discovery has no network, Electron, plugin, persistence or permission side effect. Empty/no selection keeps the shortcut board.

The optional Selected Text Actions package remains a public-SDK example rather than the product delivery mechanism. Its earlier install/click behavior is **USER CONFIRMED PASS**, but users do not need that package for the two built-in actions. Existing installations of the example can display duplicate conceptually equivalent actions until the user removes the optional example; WebTools does not silently uninstall user packages. Built-in Translation continues its separate Manager handoff; independent plugin Windows receive the existing invocation context. This phase does not add real same-panel Translation, a dictionary, or automatic preview. See the [6G-2 plan](superpowers/plans/2026-10-16-phase6g2-selected-text-basic-parity.md).

Current source: **Copy Capture with decoupled compact first presentation (2026-10-14)**. The current flow below supersedes the logo-only pending surface and the 200ms transaction cutoff.
The user approved replacing UIA text capture with application Copy after repeated failures and a reported browser/Codex regression. The capture/focus contract below retains that direction; the initial presentation timing follows the user's later uTools state/timing requirements. Targeted Checks are **42/42 PASS** and NativeHost Release build passes. This correction has not received packaged desktop visual acceptance. Historical implementation and measurement sections are retained as history; their limitations remain recorded in [the hardening report](super-panel-compatibility-performance-hardening.md).

## Mouse-first product model

Super Panel is a temporary C# + WPF surface inside the resident NativeHost. It opens through one configured mouse gesture or Tray → Super Panel. It does not register a keyboard shortcut. Launcher's keyboard hotkeys, providers, ranking and input behavior are unchanged; application results remain above Plugin Features.

The header contains a concise context title and one Search icon. Search dismisses Panel, clears its transient context and invokes the existing MainWindow.ShowFromTray path, which activates/focuses Launcher. There is no Panel TextBox, search index, second search window, Settings button or X close button. Panel uses ShowActivated=false, WS_EX_NOACTIVATE and WM_MOUSEACTIVATE handling; it does not request focus even when clicked. It is mouse-operated. One passive Escape observer lasts through capture and visible presentation and is released on dismissal. The physical mouse observer closes it on the first outside click, including outside an open shortcut menu. Feature invocation may intentionally open its destination window.

No automatic translation, fake Feature, plugin package or SDK distribution was added.

## Design decisions and geometry

The frontend-design Skill was actually re-read at:
C:/Users/admin/.agents/skills/frontend-design/SKILL.md.

The design plan was reviewed against the user's mouse-menu brief before implementation: reduce the surface itself, remove redundant chrome/search, use distinct grid/menu structures, and show real content rather than widening a small application window. This replaces the previous 456-DIP layout, not merely its spacing.

Existing LauncherThemePalette supplies the tokens:

| Role | Dark | Light |
| --- | --- | --- |
| Surface | #18191b | #ffffff |
| Icon surface | #202124 | #f7f9fb |
| Text | #f4f4f5 | #1b2633 |
| Secondary text | #a1a1aa | #5f6f80 |
| Hover | #242528 | #edf2f7 |
| Divider | #2c2d30 | #d6dee7 |

Segoe UI: header/action 13 DIP, preview 12, tile/secondary text 11. Tile titles wrap to at most two 14-DIP lines with trimming; their content width is constrained by the square cell. Outer radius 10, control/icon radius 8, outer padding 12. Hover/pressed backgrounds and keyboard focus rings reuse existing theme resources. Context rows have one icon/title line; Plugin identity remains available through a tooltip. No decorative cards, motion, glass or new theme engine.

NoContext geometry derives from a preferred **72×72 DIP clickable Tile**, 2-DIP cell margins, three rows/columns, and 26-DIP outer padding/border. Thus the normal grid is **228×228 DIP**, Panel width **254 DIP**, and the board/footer area **264 DIP** (228 + 36), regardless of shortcut count. Both Tile axes use the same resource and shrink together if the monitor work area constrains geometry. The Board ListBox uses an ItemsPresenter-only template so its fixed grid does not inherit a scrolling viewport's sizing. Long titles cannot determine the window or column width. Context width is capped at **290 DIP** and available work width; its height is content-driven with normal minimum 140 and maximum 560 DIP. Actions additionally cap at 240 DIP and scroll. Small work areas and DPI rounding still need runtime observation.

Placement captures cursor position and that monitor's work area/DPI once per presentation. Physical horizontal position is cursor X minus half the panel's pixel width. The panel starts 12 DIP below the cursor; when its actual content height cannot fit below, it opens 12 DIP above. The final rectangle is clamped to work area, excluding the taskbar. Native SetWindowPos uses physical coordinates; DIP sizing uses the captured monitor scale. Moving the mouse does not change the anchor. Dynamic projection changes may remeasure at the same anchor.

## Five context presentations

SurfaceContextMode is derived from the capture result, independently of Feature matching:

| Mode | Presentation | Real action eligibility |
| --- | --- | --- |
| NoContext | Fixed 3×3 user-curated board; Add, remove, drag ordering, pagination | Explicit saved choices of general installed/built-in Features only |
| SelectedText | Selected-text title, raised bounded three-line preview, character count, vertical actions | Declared selected-text matching; built-in Translation can use existing handoff |
| SelectedFiles | File-action header, vertical actions, separated footer with counts, first three filenames and overflow | Declared file/directory rules for every kind in a mixed selection |
| SelectedDirectories | Selected-directory count, folder glyph/name rows before vertical actions, overflow | Declared directory rules |
| ExplorerFolder | Explorer header, distinct folder identity block with display name/path and “未选择项目” | No plugin invocation context is invented; empty action state |

NoContext contains only explicit saved shortcuts. It never automatically fills slots with recommendations. Add opens an in-panel picker of available general Features; selecting adds without invoking. Remove and move commands use the shortcut context menu. Drag changes the saved reference order; dragging onto a page arrow allows moving between pages. Pagination shows nine slots per page, with hidden empty cells rather than fabricated Features. The existing atomic SuperPanelStateStore saves Pinned references/order, preserving trigger preferences and the schema. Unavailable saved references remain retained and hidden, as before.

Context modes put available pinned actions first, followed by other genuinely matching actions in a single compact scrolling menu. They expose no shortcut Add/drag/menu/pagination. Zero matching actions displays “暂无适配功能” **in the detected context layout**. It never changes SelectedFiles/Text/Directories/ExplorerFolder into NoContext. General no-context Features are not misrepresented as file actions.

The previous capture code returned None whenever Explorer SelectedItems.Count was zero. It now reads Document.Folder.Self filesystem metadata for the foreground Explorer HWND, giving ExplorerFolder its own native visual context. Virtual Shell views remain unsupported. No directory enumeration or content read occurs. ExplorerFolder has no NativeLauncherTextContext payload and is not forged into explorer-selection/selected directory; its paths are neither sent to plugins nor saved.

## Capture, activation and privacy

Selection capture starts alongside presentation of the existing window's real header (WebTools title and Search action), with the action surfaces collapsed. This content is measured/arranged before Show; normal compact height is 64 DIP and width follows the existing board geometry. After the compact render/reveal dispatch, a first UI check targets 50ms from capture start. A ready validated result selects its context directly; an unfinished capture expands the default nine-slot board while the same transaction continues. The checkpoint does not cancel Copy or accept a final NoContext outcome. Text performs one application Copy operation (Ctrl+C, or Ctrl+Insert for known native console/Windows Terminal hosting classes) and observes new clipboard sequences through the invocation's original 650ms budget. Unchanged/old clipboard contents are never treated as selection. Original window/focus, clipboard owner, intent generation and deadline remain acceptance conditions. A physical key or outside click cancels; an inside click or wheel operation freezes presentation without cancelling the Copy/restore worker. Thus late results cannot replace a user's picker/page, and stale/expired results cannot revive a dismissed window. Native password Edit controls are rejected; UIA text discovery is not in the production path. Files/directories retain Shell metadata bound to the original foreground HWND. Existing text/item/envelope bounds and the single outstanding STA worker remain.

Clipboard use is limited to this user-triggered transaction, with optional transient backup and conditional restoration. Supported complete flat-memory backup is bounded; foreign-owned potentially delayed data, unsupported formats and failed backup do not prevent capture. Such cases leave the copied result in the clipboard. Restoration never unconditionally overwrites a later detected update/user input. Since the user's 2026-10-13 correction, Copy sent without a new text update, empty text and non-text results open the normal general board in every application; the outer timeout uses the same rule if no update was observed. Actual access/input/attribution/read errors retain a Native tray notification. A sequence of zero is a valid initial counter after clipboard access succeeds, not a reason to reject the first capture. Captured text and backup contents are neither persisted nor logged. There is no idle clipboard monitor or plugin clipboard API. Explorer folder visual metadata is ephemeral; only an explicit Feature click delivers the existing context through the authenticated pipe. Main live revalidation and Translation handoff remain unchanged, with no automatic translation.

After an injected Copy is cancelled by dismissal/focus change, its existing worker can use the **remaining original budget** to observe an owner-verified update and restore a complete backup, without reading late text. New physical input stops this cleanup; a newer sequence/unverified owner prevents a restoration write. No worker replacement or indefinite watch is introduced. An application's write beyond the 650ms budget cannot be guaranteed restored, and an unavailable complete backup retains the previously approved non-restoration behavior.

## Initial presentation state transitions (2026-10-14)

| Event | Visible state | Capture/clipboard lifetime |
| --- | --- | --- |
| Trigger | Real compact header in the same nonactivating HWND; old context cleared | One invocation/worker starts in parallel |
| Validated result before first UI check | Corresponding text/files/directory/Explorer layout | Restore/validate completes through existing rules |
| About 50ms, result still pending | Default 3×3 shortcut board; same HWND resized | Transaction remains active; no final result accepted yet |
| Late valid result, original focus/generation and untouched panel | Switch to matching context | Same transaction completes |
| Panel click/wheel operation | Current page/picker retained | Late UI update revoked; read/restore may finish |
| Keyboard, focus change, close, Launcher takeover or new generation | Revoke the old presentation; close clears transient state | Cancel; bounded owner-verified cleanup where safe |
| No result within total budget | Keep the already shown general board | Worker settles; existing accepted timeout fallback remains valid |

uTools static `triggerShow` resets the bounds before `showInactive`, then `showInit` performs its 50ms Copy check and `setWindowBounds` resizes that window. WebTools reproduces that split with WPF's measure/arrange/Show/reveal dispatch and the controller's first UI checkpoint. Differences remain: WPF header is normally 254×64 DIP (work-area/DPI constrained), board is 3×3 rather than uTools' 3×4; there is no foreground-window command matching contract here, so the interim fallback is the default board. WebTools accepts only a fully validated result and continues observing slower Copy through 650ms, whereas the provided uTools `showInit` excerpt shows one 50ms decision. Its static excerpt is not evidence of the same restoration/lifecycle rules. Initial WPF HWND/render preparation can delay observation of the checkpoint; 50ms is not a compositor or cold-start guarantee. Full comparison and actual regression results are in the hardening report.

Tray → Super Panel explicitly opens the general board without attempting Copy from the tray/menu. Use the configured mouse gesture in the source application for capture. Application Copy semantics can include current-line copy without a visible selection; custom copyable sensitive controls are not universally identifiable through Copy. Temporary clipboard writes may be visible to clipboard history/managers even after restoration. Null/cross-process clipboard owners are currently treated as ambiguous, and native delayed rendering is not forcibly preempted. These limits and real application compatibility require runtime verification.

## Mouse triggers and consumption

Manager offers:
- 鼠标中键 (middle)
- 鼠标侧键 1 / 后退键 (xbutton1)
- 鼠标侧键 2 / 前进键 (xbutton2)
- 按下 (press) or 长按 (hold)
- Hold duration 300–1500 ms, hidden for Press.

The default remains middle + hold, 600 ms. The sole observer distinguishes WM_XBUTTONDOWN/UP through the high word of MSLLHOOKSTRUCT.mouseData (1 versus 2). Unconfigured buttons and injected events pass through.

When opening/toggling through a trigger, Press consumes the configured physical DOWN and its corresponding UP. Hold defers that configured DOWN; reaching the threshold consumes the gesture and suppresses the corresponding UP, avoiding simultaneous browser Back/Forward. An outside click dismissing an already-visible Panel is the explicit exception: both original DOWN and UP pass through even for the configured trigger, with no delayed re-open or replay. A short non-trigger hold restores only that user's mouse click with SendInput. Movement beyond the existing 12-pixel tolerance cancels the hold, restores DOWN and lets normal UP pass. This is mouse click restoration only, never keyboard/Copy injection. SendInput failure (including Windows integrity restrictions) is diagnostic, not silently certified.

Updating an enabled binding reconfigures the same hook. Timers and binding generation invalidate pending old gestures. Disabling prevents new activation and cancels capture intent. If a consumed DOWN has already fired, a deactivated observer balances its matching UP before unhooking; it cannot launch another Panel. Otherwise it releases immediately. Unhook failure retains an inactive delegate until safe release/process exit, as required to avoid callbacks into freed delegates.

Actual side-button behavior, short-click restoration, browser compatibility, elevation, disable-mid-gesture and hook timing await the separately authorized Windows preview.

## Manager-only settings and native authority

**Manager → Settings → Super Panel** is the only trigger settings UI. Native dialog/recorder and Panel settings button are removed. Tray → Super Panel 设置 dismisses Panel and opens the existing Manager Settings page, with a narrow authenticated open-page target that scrolls/focuses this section. It reuses the existing Manager coordinator/window and acknowledgement path.

The Manager component uses the existing settings group, field-label Select, toggle-switch, field colors, buttons, descriptions, slider and error state. It provides Enable, mouse button, gesture, conditional hold duration, Restore Defaults, Apply and Cancel. It displays actual active trigger or failure; there are no keyboard registration/occupied controls.

NativeHost owns OS hook state and the only persisted configuration. Internal capability **super-panel-settings-v2** negotiates the closed four-field settings object: enabled, mouseButton, gesture, holdMilliseconds. Status carries settings, triggerStatus (registered/failed/disabled), activeTrigger or null, and bounded error. The named get/update/change RPCs retain authenticated peer checks, current Manager main-frame authorization, Main validation and preload listener cleanup. Manager never directly writes JSON or creates a second DataStore copy.

SuperPanelSettingsController applies the trigger, atomically saves latest state including pins, and attempts rollback if persistence fails. Native super-panel-state.json becomes schema 2 for this mouse product change. Existing schema 1 is normalized **in memory**: original middle-hold preference/duration and pins survive; legacy keyboard is never registered. If middle hold was disabled, the new mouse trigger remains disabled. No startup rewrite occurs; explicit save persists schema 2. This migration is unrelated to installer diagnosis, and no actual user file was read/reset/rewritten during this task.

Pin/unpin/reorder remain available on real action context menus. Unavailable/mismatched pins remain persisted but hidden. The removed native settings pin editor has no replacement editor for unavailable pins in this scope.

## Round 2 artifact/entrypoint investigation — read-only, 2026-10-11

User-confirmed history: Portable was exited including tray before installing and starting the installed entry; the installed tray then showed an older-looking Panel. This is preserved as reported and is not explained away as the user launching the wrong executable.

The earlier delivery flow actually used:
- Native publish: release/phase6f3-super-panel-round2-20261010/stage/host.
- Portable: same release directory's WebTools-Phase6F3-SuperPanel-Round2-Preview, copied from that host stage.
- NSIS: the generated native-production.nsi, File /r stage/host/*.* and stage/manager/*.*.

Existing files were examined without executing an application/installer, writing an extraction fixture, or changing the original artifacts. The original installer was inspected using the installed electron-winstaller 7z archive reader, streaming its NativeHost DLL to a hash calculation.

| Source | NativeHost DLL size | SHA-256 |
| --- | ---: | --- |
| Round 2 host stage | 788992 | FD4DD49AC0AF5EBB05AAC9ECFB115645699BCEFFFAF631DF84C741514490A65A |
| Round 2 Portable | 788992 | same |
| Round 2 installer embedded DLL | 788992 | same |
| Current installed D:/webtools DLL | 788992 | same |
| Earlier phase6f3-preview-20261010 host stage | 733696 | 61BEC53A72EAB2D2208CB5912CC498380D7D36ACED4730B2B0CA809C0CD8A5F2 |

EXE apphost bytes are identical even between the older/newer DLL revisions, so checking only EXE/version 0.1.0 would not distinguish the UI. The managed DLL contains the WPF implementation.

Additional current observations:
- Only one registered WebTools installation was found: HKCU uninstall identity WebToolsNative, InstallLocation D:/webtools, version 0.1.0.
- Desktop shortcut D:/SystemDefault/Desktop/WebTools.lnk and Start Menu Programs/WebTools/WebTools.lnk both target D:/webtools/WebTools.NativeHost.exe, no arguments.
- Current NativeHost PID 22204 was created 2026-10-10 23:20:32 +08:00 from the Round 2 Portable path. This is a **current observation**, not a historical PID attributed to the user's installed-UI check.
- Current HKCU Run WebTools points to that Portable executable.
- App used a global per-user Local/WebTools.NativeHost mutex. A second instance exits immediately. It does **not** forward a request to another instance.
- LoginStartupService.Apply uses Environment.ProcessPath. Previously, a normal Portable startup used the real Nook preference and could overwrite/delete the same Run registration.
- NSIS snapshots whether a Run value existed, waits for old uninstall, then writes the installed NativeHost path when enabled before finish-page launch. A later Portable startup can overwrite it again.
- Shared Nook contains trigger/pin/projection state, not a persisted Panel layout or NativeHost assembly location. Packaged Manager discovery starts from the running NativeHost directory (with the existing explicit environment override/fallbacks); it does not select the NativeHost WPF DLL from Nook.

**Historical “Installer new payload but old-looking UI” root cause is NOT CONFIRMED.** The available bytes disprove that this retained installer embedded the earlier NativeHost DLL. Current Portable startup ownership and silent cross-directory singleton handling are confirmed source-level problems, but do not prove they occurred during the user's explicitly described sequence. No historical responding PID/image/GUI record is available, and this task does not authorize a reproduction. It would be incorrect to claim the old-UI observation has been explained or runtime-fixed.

Source corrections for the next preview:
- Log actual NativeHost executable and bounded preview revision at startup.
- Explain a different running installation with both executable paths instead of silently exiting; do not forward, terminate or replace that instance.
- A preview identified by preview-build.json may own startup registration only if its application directory equals the registered installation. Unregistered Portable preview leaves existing startup untouched and rejects startup preference changes before persisting them. Installer copies the same marker; the registered installed copy still owns normal startup.
- Existing real Run value, shortcuts, production processes, profile and installation were untouched during diagnosis. These source changes are not active until a new authorized build is run.

## Canonical staging ownership and next packaging

build-native-production.ps1 now constructs one fresh application tree:
```text
new release/native-preview-<timestamp>/
  stage/
    application/
      WebTools.NativeHost.exe
      WebTools.NativeHost.dll
      all self-contained runtime/assets
      app.ico
      preview-build.json
      Manager/
        WebTools.exe
        resources/app.asar
        all Electron resources
    updater/WebTools.UpdateHelper.exe
```

NSIS File /r stage/application/*.* and Portable Compress-Archive both read **that same tree**, including identical preview metadata. Host is published once; Manager win-unpacked is copied once into application/Manager. NSIS SetOverwrite on is explicit. Existing waited previous-uninstall/new-install ordering remains before file replacement. No profile reset is involved.

Fresh output paths are mandatory; existing directories are refused, including old Round 2 paths. Old preview ZIP/installer/stage remain preserved. release-build.mjs component collection was updated to application/ and application/Manager; default release validation is retained.

The existing packaging script adds an explicit PreviewOnly mode and required PreviewName. Default production mode still runs its original checks/install smoke. PreviewOnly builds components and packages without tests, running binaries, installing/uninstalling or writing an acceptance PASS. It produces the same existing NSIS installer framework plus ZIP and retains canonical unpacked application and Manager win-unpacked.

The retained Round 2 NSIS compile ran from 23:09:27 to artifact completion at 23:14:34 (over five minutes). The orchestration's old five-minute deadline could terminate that successful compressor when using the formal script. Only makensis compilation now has a bounded 15-minute deadline; actual installer execution retains five minutes. No compression or installer framework change is made.

The earlier, separately authorized Round 3 packaging used this command (not executed again in this development pass):
```powershell
pnpm run package:win -PreviewOnly -PreviewName WebTools-Phase6F3-SuperPanel-Round3-Preview -Channel beta
```

preview-build.json contains only productVersion, previewName, gitHead, dirty, buildTimestamp and superPanelUxRevision. The earlier Round 3 package used phase6f3-super-panel-round3; the older mouse-first-round2 description is superseded. No absolute paths, profile, secrets or token data. This is small artifact identification, not a new evidence baseline or public release mechanism. No metadata/artifact was generated in the current development pass; the existing Round 3 binaries do not contain the newest UI changes.

## Source changes and remaining validation

| Area | Production/document files |
| --- | --- |
| Native UI/context | SuperPanelWindow.xaml/.xaml.cs, SelectionContext.cs, SelectionCaptureService.cs, MonitorPlacement.cs |
| Mouse/config authority | new MouseTriggerObserver.cs replacing MiddleHoldObserver.cs, SuperPanelTriggerController.cs, SuperPanelStateStore.cs, SuperPanelSettingsController.cs |
| Native integration/entrypoint | App.xaml.cs, ManagerController.cs, NativeManagerPipeServer.cs, LoginStartupService.cs |
| Manager/protocol | SuperPanelSettings.vue, SettingsView.vue, App.vue, shared super-panel-settings.ts, ipc.ts, native-manager-intent.ts, electron/main.ts, native-manager-client.ts, native-manager-commands.ts |
| Packaging | build-native-production.ps1, native-production.nsi, release-build.mjs |
| Formal documentation | this document |

Round 1 history remains relevant only as superseded design: its dedicated keyboard receiver addressed source ownership/failure visibility, but the original Ctrl+Alt+P failure was never runtime-root-caused. The user now removes that product trigger entirely. Round 2 build previously compiled/published source after the minimal HorizontalAlignment and release-preflight recognition fixes. That build success was not UX acceptance.

Current source awaits review before a separately authorized **Packaged UX Preview — Final**. Required future preview observations include shortcut Add/remove/drag/cross-page ordering and restart persistence, first outside click without first focusing Panel, typed Explorer/text capture, zero-match layout, narrow geometry/DPI/edge flip, Launcher handoff focus, physical side-button Press/Hold and ordinary click behavior, Manager-only settings and tray section navigation, installed/Portable metadata equivalence and preserved startup ownership. The historical installed old-UI cause remains an open investigation; it is not certified fixed.

**TESTING NOT RUN — USER HAS NOT AUTHORIZED TESTING**

**PACKAGING NOT RUN — USER HAS NOT AUTHORIZED PACKAGING**

No build/typecheck/AST or syntax verification, tests, plugin fixture, manual UX, acceptance runner or new package was executed/generated. No stage/commit/push; no Phase 6F-4, Phase 6G or SDK distribution.

## Historical Round 3 final development report (superseded by UI Contract Fix below)

Scope authority: the current working tree, this document, the final Context Presentation addendum and the user's clarification confirming the three closeout goals. The missing original numbered prompt is not a blocker and is not reconstructed. Existing trigger settings, capture, invocation, packaging and installation behavior are retained except for the targeted dismissal integration described here.

### Goal 1 — Shortcut Board

SuperPanelWindow now renders NoContext through a dedicated fixed-height 3×3 board, separate from the context action ScrollViewer. Nine slots remain even when zero or one shortcut is available. Add opens an inline general-Feature picker; selection only adds a reference. Right-click removal, drag ordering and page arrows operate on the existing Pinned sequence. More than nine visible shortcuts creates further pages. Cross-page dragging uses the page-arrow drag-enter path. No automatic recommendation list is rendered or populated for NoContext. Save failures retain the store's prior state and show an error. Restart persistence uses the existing atomic store; it has not been runtime-verified in this pass.

### Goal 2 — Transient Dismiss

MouseTriggerObserver forwards physical button-down coordinates through SuperPanelTriggerController to the visible Window, using the existing hook. GetWindowRect checks physical bounds before dismissal is dispatched. A dedicated visible-generation counter rejects an old queued dismissal after hide/show; icon refresh and pagination do not invalidate a valid outside click. This path does not depend on IsActive or prior Panel interaction. Ordinary external clicks continue to their target. A configured trigger pressed outside an already-visible Panel is treated as dismissal and balances its consumed release, avoiding immediate re-open. Existing Deactivated/Escape handling remains. Shortcut menus and an active drag use their existing interaction ownership instead of being closed mid-operation. No extra hook, focus polling or fixed timeout is added.

### J. Context Presentation

- **No Context:** fixed nine-slot board, inline Add picker and footer paging. Empty cells are not fake Features. It has no selection preview.
- **Selected Text:** dedicated raised text region above the action menu; actual captured selection only, at most 220 UTF-16 code units without splitting a surrogate pair, an explicit ellipsis when shortened, and at most three 18-DIP lines. Captured text-element count and capture truncation are shown separately. The preview does not alter the original invocation payload.
- **Selected Files:** actions first, then a separated selection footer. It shows exact captured file count (and directory count for mixed selections), the first three names, and “另有 N 项”. Names are single-line ellipsized. No content read or directory scan is added.
- **Selected Directory:** selected-directory count and folder-glyph/name rows before actions; first three names plus overflow. These are the explicit captured selections.
- **Explorer Current Folder:** Explorer heading and a distinct folder block with display name, bounded path label and “正在浏览的目录 · 未选择项目”. This comes from existing native metadata, not a selected-directory payload. With no accepted current-folder contract it shows “暂无适配功能”; no invented terminal/editor actions appear.

Capture determines presentation mode; Feature matching only determines available actions. Context action height caps at 240 DIP and remaining actions scroll, with no Add/drag/paging/shortcut context menu. Context chrome and height remain content-driven. Dismiss clears all text, names, Explorer metadata, list sources and pending icon-generation ownership. The same theme resources, typography and compact outer window are used across all modes.

### Deferred product capability — Quick Result / Translation Preview

“Select English text → see a quick translation directly in Super Panel” remains an intended product capability. It has **not** been rejected. A future real Translation Feature/Plugin should supply Quick Result data for Super Panel to present. The present text-summary region is structurally separate from actions, leaving the boundary between them available for a future compact result region. No blank result card, fake translation, hard-coded meaning, preview-only API/AI request, NativeHost translation service or new preview contract is implemented now. Future implementation depends on the real Feature platform and a separately authorized contract.

### Current-pass file scope and verification limits

Only these six files were edited in this pass:

- native/WebTools.NativeHost/SuperPanel/SuperPanelWindow.xaml
- native/WebTools.NativeHost/SuperPanel/SuperPanelWindow.xaml.cs
- native/WebTools.NativeHost/SuperPanel/SelectionContext.cs
- native/WebTools.NativeHost/SuperPanel/MouseTriggerObserver.cs
- native/WebTools.NativeHost/SuperPanel/SuperPanelTriggerController.cs
- docs/super-panel.md

The changes received source inspection only. Build correctness, physical mouse timing, drag behavior, focus, rendering and persisted-order UX are not claimed as PASS. No tests, fixtures, runner, baseline, compilation, typecheck, package, application launch or manual acceptance was performed or added. Real installation/profile/startup data and unrelated dirty work remain untouched. No Git stage/commit/push was performed.

**TESTING NOT RUN — USER HAS NOT AUTHORIZED TESTING**

**PACKAGING NOT RUN — USER HAS NOT AUTHORIZED PACKAGING**

## Final UI Contract Fix — Development Report (authoritative current correction)

### A. Root Cause

**ROOT CAUSE NOT CONFIRMED** for the user's observation that Explorer presentation appeared while selected Text/File/Directory did not. This pass inspected production source only; it did not observe the user's captured payload, responding window or selection provider. It does not attribute the observation to incorrect user operation.

The complete existing route was read:

1. `SuperPanelTriggerController.Toggle` awaits `SelectionCaptureService.CaptureAsync` before presenting/activating Panel.
2. Capture snapshots the foreground HWND/PID. `CaptureExplorer(foreground) ?? CaptureText(processId)` chooses the capture source. Explorer checks the window class and matching Shell HWND; **positive SelectedItems.Count reads selections**, with all-directory selections producing `directories` and any-file selections producing `files`. **Only Count == 0 reads the current Folder.Self**. Explorer metadata therefore follows a different branch from selected items.
3. UIA text capture currently requires **the focused element itself** to expose TextPattern, match the foreground PID and not be a password element. It does not search other elements for text. This is an existing capture limitation, not evidence that a particular user's application failed this check.
4. Busy capture, 650-ms timeout, foreground change, unavailable UIA selection, invalid/oversized paths or rejected invocation envelope can produce `SelectionContext.None`. The text/file/directory branches validate a bounded Super Panel request before returning a payload; current-folder metadata has no invocation payload. These are source-confirmed branches, not a confirmed explanation of the observed failure.
5. `SelectionContext.Mode` maps payload `text/files/directories` directly to the corresponding presentation; absent payload plus Explorer metadata maps to ExplorerFolder. Feature matching does not mutate this context. Before this correction, typed captures already selected their preview blocks; there was no source evidence that zero matching Features changed a valid selection into NoContext.

Two concrete contract defects were visible in source and corrected: (a) 330-DIP window-driven column widths combined with a fixed 76-DIP Tile height, without a square constraint; (b) configured-trigger outside clicks set `_fired` but still consumed DOWN/UP. Earlier documentation described intended source structures too broadly relative to runtime evidence. This report distinguishes source implementation from visible packaged acceptance. Capture source and protocol validation were not speculatively rewritten.

### B. No Context XAML Structure

`BoardSurface → BoardGrid → BoardList → ItemsPresenter → UniformGrid(Rows=3, Columns=3) → FeatureTile`.
`ApplyGeometry` supplies the same `ShortcutTileSide` to Button Width and Height. Preferred side is 72 DIP; cell margins are 2 DIP, so normal grid side is `3 × (72 + 4) = 228`. Outer padding/border adds 26, yielding a 254-DIP Panel. The footer adds 36 DIP vertically. Nine item slots remain regardless of shortcut count. The title has a bounded content width, two-line/28-DIP maximum and trimming. The Add control is in the footer, beside page controls. No Feature desired width drives geometry.

### C. Context Routing

`Present(context) → ApplyGeometry(context.Mode) → PresentContext(context) → RefreshFeatures()` is the production order. `PresentContext` first collapses all roots, then selects BoardSurface or ContextSurface and exactly the appropriate preview root. `RefreshFeatures` now only fills actions/shortcuts and never chooses surface visibility or switches templates between grid and rows.

| Capture result | SurfaceContextMode | Actual visual containers |
| --- | --- | --- |
| No payload and no Explorer metadata | NoContext | BoardSurface / BoardGrid; ContextSurface collapsed |
| text payload | SelectedText | ContextSurface / TextContextRoot + FeatureScroll; BoardSurface collapsed |
| files payload, including mixed selection | SelectedFiles | ContextSurface / FeatureScroll + FileContextRoot footer; BoardSurface collapsed |
| directories payload, all selected items directories | SelectedDirectories | ContextSurface / DirectoryContextRoot + FeatureScroll; BoardSurface collapsed |
| no selected items, valid current-folder metadata | ExplorerFolder | ContextSurface / ExplorerContextRoot + FeatureScroll; BoardSurface collapsed |

All four context modes retain their preview root when matching produces no actions; `EmptyText` then shows “暂无适配功能”. The actual XAML row template is permanently FeatureAction. Only BoardList uses FeatureTile. Add/drag/page controls are descendants of the collapsed BoardSurface in every context mode.

### D. Selected Text

The header identifies selected text and its captured character count. TextContextRoot displays `context.Preview` from the real captured payload, capped to 220 UTF-16 units without splitting a surrogate pair, explicit ellipsis on shortening, and three 18-DIP lines. TextCount retains captured count/truncation information. FeatureAction is a single icon/title row; identity is in its tooltip. The preview/actions boundary remains available for a future real Feature-backed Quick Result. No automatic request or fake translation is present.

### E. Selected Files

FileContextRoot is a separated footer beneath vertical actions, containing a document glyph, captured file count (plus folder count for mixed selections), the first three item names and an overflow count. Names are single-line trimmed. It remains visible with zero actions. No new file-content access or enumeration was introduced.

### F. Selected Directory

DirectoryContextRoot renders explicit selected-directory names with individual folder glyphs and overflow; the header shows selected-directory count. It is selected only by the existing `directories` payload, independent of Explorer current-folder metadata and Feature availability.

### G. Explorer Folder

ExplorerContextRoot identifies Windows Explorer, the current folder name/path and “正在浏览的目录 · 未选择项目”. It uses native visual metadata with no forged selected-directory payload. No compatible current-folder Feature contract exists here, so the action area stays empty with “暂无适配功能”.

### H. Shortcut Board

The existing Add picker appends a real general FeatureRef without invoking/installing it; Remove edits only the shortcut reference. Drag reorders the canonical Pinned sequence, and dragging onto a page arrow permits cross-page movement. PageSize is explicitly `3 × 3`. Existing atomic SuperPanelStateStore persistence is retained. No automatic recommended shortcuts, fake actions or filled placeholder Features are introduced. Unavailable stored references remain hidden/retained under the existing behavior.

### I. Outside Dismiss

The existing WH_MOUSE_LL observer reports physical button-down positions to `ObservePointerDown`, which compares physical GetWindowRect bounds and queues generation-checked dismissal. Neither this decision nor its callback requires IsActive or a prior Panel click. The configured-button outside branch now sets forwarding state and lets both original DOWN and UP reach the target; it does not start a hold timer, toggle open again or replay input. Existing menu/drag interaction ownership remains. Cursor-centered positioning, 12-DIP gap, upward flip, work-area/taskbar bounds and DPI conversion remain in MonitorPlacement; it positions using the newly derived window width.

### J. Files Changed in this correction

- `native/WebTools.NativeHost/SuperPanel/SuperPanelWindow.xaml`
- `native/WebTools.NativeHost/SuperPanel/SuperPanelWindow.xaml.cs`
- `native/WebTools.NativeHost/SuperPanel/MouseTriggerObserver.cs`
- `docs/super-panel.md`

frontend-design was re-read and applied within the user's fixed contract: shared light/dark tokens, compact spacing, square icon-over-title tiles, one-line context rows and existing hover/keyboard-focus treatment. No test, fixture, runner, baseline, capture contract, plugin API or packaging file was modified in this correction. Existing unrelated dirty work is preserved; no stage/commit/push occurred.

### K. Remaining Risks / Acceptance Boundary

- The precise selection-capture branch responsible for the user's previous observation remains unknown. UIA/provider compatibility, Explorer selected-item capture and the actual resulting presentation must be observed after separate authorization; UI restructuring alone does not prove capture recovery.
- WPF compilation, binding/rendering, two-line ellipsis, square footprints at Windows DPI settings/small work areas, physical outside-click propagation, drag/pagination and restart persistence have not been executed in this pass.
- No packaged UX PASS or Phase 6F-3 completion is claimed. Existing preview binaries predate this correction. Future Quick Translation remains an approved deferred product direction, supplied by a real Translation Feature/Plugin rather than a second NativeHost service.

**TESTING NOT RUN — USER HAS NOT AUTHORIZED TESTING**

**PACKAGING NOT RUN — USER HAS NOT AUTHORIZED PACKAGING**

## Copy Capture no-context presentation ownership (2026-10-13)

The source-only limits in the historical sections above describe those individual passes. The user has since authorized focused functional testing and packaging for the no-selection disappearance.

No new Copy result produces the general 3x3 board. When the capture deadline cancels its worker, the accepted `TimedOut / NoContext` fallback remains visible; worker cancellation alone must not immediately dismiss its presentation. This exception applies only to a timeout fallback without capture error or physical-input change. Stale generation, changed foreground/focus, explicit dismissal and Launcher takeover still revoke it. No extra delay or re-show is used.

The regression failed before the controller fix and passes afterwards; focused WPF checks pass 19/19. Ten real isolated Chromium no-selection cases pass, including empty test clipboard formats, and three selected-text cases pass. Word foreground automation could not reliably execute a capture and remains unverified. Physical keys are not inferred from injected SendKeys. Current broad Node/typecheck failures are recorded separately.

The current evidence, safeguards, intermediate failures, corrected ZIP and exact build identity are recorded in `super-panel-compatibility-performance-hardening.md`, section “No-selection board disappears — functional fix and verification”. This establishes a focused lifecycle fix, not universal application compatibility or final Phase acceptance.
