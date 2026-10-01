# Native Launcher Hotkey System 2.0 Implementation Plan

> **Execution status:** Approved by the user with final product decisions in `C:\Users\zry\.codex\attachments\ebdab112-2449-4045-80b4-093f021ba2ac\已粘贴的文本.txt`. Execute in dependency order with test-first changes.

**Goal:** Extend Native Launcher hotkey configuration with common chords, Double Ctrl/Double Alt, F1–F10, and custom chords while preserving persisted shortcuts, transactional replacement, NativeHost ownership, and the existing Launcher activation behavior.

**Architecture:** Keep `quickSearchShortcut` as the existing persisted and synchronized string field, but parse it in NativeHost into a typed `HotkeyBinding` union (`Chord`, `FunctionKey`, `DoubleModifier`). Preserve current chord serialization; use explicit canonical forms `FunctionKey:F1`…`FunctionKey:F10` and `DoubleModifier:Control` / `DoubleModifier:Alt` for new modes. Route chords and function keys through `RegisterHotKey`; install a passive `WH_KEYBOARD_LL` observer only for a DoubleModifier binding. A pure, deterministic gesture recognizer owns double-tap semantics. `GlobalHotkeyService` coordinates mode changes transactionally and always invokes the existing `OnHotkey` activation path.

**Tech Stack:** .NET 10 WPF, Win32 `RegisterHotKey` / `WH_KEYBOARD_LL`, existing Named Pipe settings synchronization, Vue 3 Settings UI, existing NativeHost console checks. No new dependency and no AppData schema-version change.

**Source specs:** `C:\Users\zry\.codex\attachments\8e67ae8c-b535-48de-9b72-b2e560541947\已粘贴的文本.txt` and the user-approved final decisions in `C:\Users\zry\.codex\attachments\ebdab112-2449-4045-80b4-093f021ba2ac\已粘贴的文本.txt`.

## Audited Current State

- Manager Settings currently writes `AppSettings.quickSearchShortcut` through `window.desktop.updateSettings`.
- Electron Main synchronizes Launcher settings over the existing Native Manager Named Pipe. NativeHost owns actual registration; Electron does not own a global shortcut.
- NativeHost persists `quickSearchShortcut` in `LauncherStateStore` as a string, defaulting to `Control+Alt+Space`, under the existing schema version.
- `GlobalHotkeyService.TryParse` currently accepts only modifier-plus-key chords. Registration already attempts the new chord before unregistering the old chord, and settings are persisted only after NativeHost accepts the change; App settings rollback restores runtime/store state if persistence fails.
- `SettingsView.vue` currently has one key recorder that requires at least one modifier and displays the serialized string.
- `NativeManagerPipeServer` and `LauncherStateStore.IsValid` both validate via `GlobalHotkeyService.TryParse`; both must move to the canonical binding parser in the same change.
- `WebTools.NativeHost.Checks` is a custom console/STA runner. It includes a real Win32 registration-collision test and can host deterministic parser, state-machine, and lifecycle tests.
- `README.md` currently only says the global hotkey is configurable; it has no detailed hotkey instructions. Its Native Launcher feature bullet is the only section to update.
- The existing Phase 4G-1 report is untracked user work. Preserve the recorded baseline table exactly and update its manual status only after the feature validation step.

## Decisions and Safety Boundaries

- Existing chord values such as `Control+Space`, `Control+Alt+J`, and `Super+Shift+K` remain parseable and retain their established canonical ordering. Aliases such as `Ctrl`, `Win`, and `Meta` remain accepted where currently supported.
- The default stays `Control+Alt+Space`; Alt+Space and Ctrl+Space are labeled **常用组合**. Every preset creates a pending value; only Apply requests registration and persistence. Cancel leaves the active value unchanged.
  - `FunctionKey:F1`…`FunctionKey:F10` and `DoubleModifier:Control` / `DoubleModifier:Alt` are explicit persisted meanings. Bare `F1`…`F10` may be accepted as input aliases, then normalized to the explicit function-key form. Standalone `F11`/`F12` and `FunctionKey:F11`/`FunctionKey:F12` remain rejected and are not shown as presets. For compatibility with existing modifier chords, `Control+F11`/`Control+F12` and equivalent modified chords remain valid; they are never exposed as standalone FunctionKey modes.
- Do not maintain a speculative Windows shortcut blacklist. Parse valid requested forms, then treat Windows registration as the authority. Recommended chords may fail on a given machine; that must leave the previous binding active and persisted.
- The double-tap recognizer will use one centralized interval and maximum tap duration, monotonic timestamps, complete down/up taps, and no timer. Non-modifier input, another modifier, a held/long tap, repeat-down, or timeout cancels candidacy. It never suppresses keystrokes.
- Double Shift and Double Win are not exposed: Double Shift can conflict with normal typing/accessibility workflows; Double Win can interfere with the Windows shell. This keeps the supported scope to the two explicitly required modes.
- Never stop, reconfigure, or reinstall the user’s installed `D:\webtools` instance or modify the real `%APPDATA%\Nook` profile for resource sampling. Do not use the Phase 4E isolated test mode as a production-baseline comparison. A post-change sample is optional and only valid if safely production-equivalent; otherwise report `POST-HOTKEY RESOURCE SAMPLE — NOT MEASURED`.
- No Phase 4G-2 stress run, installer build, commit, push, PR, merge, tag, or release.

## Task 1: Add the Canonical Binding Model and Compatibility Codec

**Files:**
- Create: `native/WebTools.NativeHost/Models/HotkeyBinding.cs` (or the nearest existing model namespace).
- Create: `native/WebTools.NativeHost/Services/HotkeyBindingCodec.cs` if parsing/serialization does not fit the model cleanly.
- Modify: `native/WebTools.NativeHost/Services/GlobalHotkeyService.cs` to consume the typed model instead of being the parsing authority.
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`.

**Interfaces / contracts:**
- `HotkeyBinding` is an explicit discriminated model with `Chord`, `FunctionKey`, and `DoubleModifier` variants.
- A single codec owns `TryParse`, canonical serialization, and display-friendly binding data. Existing modifier/key chords round-trip with their current canonical meaning.
- `quickSearchShortcut` remains a string at persistence and IPC boundaries; no settings/DataStore schema change.

**Steps:**
  - [x] Add failing tests for existing chords, common chords, advanced chords, F1/F10, both double modifiers, aliases, display text, malformed values, unknown variants, standalone F11/F12 rejection, legacy modified F11/F12 chord compatibility, and round-trip stability.
- [x] Verify old `Control+Space` and other legacy chord values parse unchanged.
- [x] Implement the typed variants and codec; map `Ctrl` to the existing canonical `Control`, `Win`/`Meta`/`Super` to `Super`, and keep modifier ordering stable.
- [x] Reject duplicate modifiers, multiple primary keys, modifier-only chords, unknown mode tags, and keys outside the current supported chord key set.
- [x] Keep serialized function-key and double-modifier forms explicit and unambiguous; do not encode product presets as behavior branches.

**Verification:**
- Run the focused NativeHost checks and confirm parser/codec tests pass.
- Run `dotnet build native/WebTools.NativeHost/WebTools.NativeHost.csproj --configuration Release`.

## Task 2: Implement and Test the Pure Double-Modifier Recognizer

**Files:**
- Create: `native/WebTools.NativeHost/Services/DoubleModifierGestureRecognizer.cs`.
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`.

**Interfaces / contracts:**
- A pure recognizer accepts normalized key-down/key-up events and a monotonic timestamp, and reports a trigger only after the second complete target-modifier tap.
- Timing constants are centralized; the recognizer has no timer, thread, WPF, Win32, logging, persistence, or IPC dependency.

**Steps:**
- [x] Add deterministic tests first using explicit test timestamps.
- [x] Cover Double Ctrl and Double Alt; exactly-once trigger; incomplete tap; long hold; repeat-down; expired interval; non-modifier input during or between taps; another modifier; Ctrl+C then Ctrl+V; Alt+Tab; Alt+F4; and triple-tap deterministic behavior.
- [x] Track enough key-down state to reject a target tap when another non-modifier is held, and invalidate tap/candidate on any observed non-modifier input.
- [x] Normalize left/right Ctrl and Alt into one logical modifier in the event contract.
- [x] Implement the minimal state machine; timeout expires by comparing timestamps on input, without a background timer.

**Verification:**
- Run the focused NativeHost checks; all gesture tests must be deterministic and independent of actual keyboard input.
- Run `dotnet build native/WebTools.NativeHost/WebTools.NativeHost.csproj --configuration Release`.

## Task 3: Add the Passive, Mode-Scoped Windows Keyboard Observer

**Files:**
- Modify: `native/WebTools.NativeHost/Interop/NativeMethods.cs`.
- Create: `native/WebTools.NativeHost/Services/LowLevelKeyboardObserver.cs`.
- Modify: `native/WebTools.NativeHost.Checks/Program.cs` only for observer lifecycle seams if needed.

**Interfaces / contracts:**
- `LowLevelKeyboardObserver` installs `WH_KEYBOARD_LL` on the existing WPF dispatcher thread, roots its callback delegate, translates only keyboard events needed by the recognizer, and always chains through `CallNextHookEx`.
- The observer never blocks/suppresses input and performs no I/O, JSON, logging-heavy work, search, settings persistence, or Manager startup from the callback.
- The callback schedules the existing activation callback only when the recognizer reports a completed double tap.

**Steps:**
- [x] Add the required hook P/Invokes, message constants, and keyboard-event structure with correct native layout and pointer-sized signatures.
- [x] Restrict the observer to Ctrl/Alt double-modifier modes; each observer owns exactly one hook. GlobalHotkeyService will keep chord/function modes free of this hook when integrated in Task 4. Microsoft documents `WH_KEYBOARD_LL` as global-only, delivered on the installing thread, requiring that thread to keep pumping messages, and requiring callback rooting and deterministic unhooking; this matches the WPF dispatcher lifecycle but makes cleanup and callback duration critical.
- [x] Ignore key auto-repeat through recognizer state; invalidate modifier taps on non-modifier keyboard input including system-key events such as Alt+Tab and Alt+F4.
- [x] Ensure callback exceptions never cross the unmanaged boundary and shutdown disposes the hook deterministically; queued activation is invalidated on observer reconfiguration/disposal.
- [x] Expose a narrow injectable hook API/observer seam so service lifecycle tests can assert create/reuse/dispose without installing a real system hook.

**Verification:**
- [x] Run NativeHost build and deterministic observer-adapter/lifecycle checks (51/51 checks passed; Release build has no warnings or errors).
- Real Windows cross-application behavior remains in the manual acceptance checklist; do not claim it from static code or synthetic events.

## Task 4: Integrate Typed Bindings and Transactional Mode Replacement

**Files:**
- Modify: `native/WebTools.NativeHost/Services/GlobalHotkeyService.cs`.
- Modify: `native/WebTools.NativeHost/MainWindow.xaml.cs`.
- Modify: `native/WebTools.NativeHost/App.xaml.cs` only if settings-apply error propagation or rollback needs a minimal adjustment.
- Modify: `native/WebTools.NativeHost/Data/LauncherStateStore.cs`.
- Modify: `native/WebTools.NativeHost/Services/NativeManagerPipeServer.cs`.
- Modify: `native/WebTools.NativeHost/Diagnostics/Phase4EResourceTestOptions.cs` only if required to safely launch an isolated mode-specific resource sample.
- Modify: `native/WebTools.NativeHost.Checks/Program.cs`.

**Interfaces / contracts:**
- `GlobalHotkeyService.TryReplace` accepts the existing string boundary, parses into `HotkeyBinding`, and retains an explicit active mode/resource set.
- Chord and function-key modes use `RegisterHotKey` with `MOD_NOREPEAT`; function keys register with no Ctrl/Alt/Shift/Win modifier.
- DoubleModifier uses only `LowLevelKeyboardObserver` and the pure recognizer; it does not register a second keyboard shortcut.
- `MainWindow` continues to funnel every mode into the single existing `OnHotkey` callback.
- State validation and Named Pipe validation use the same codec. Store persistence happens only after successful runtime activation.

**Steps:**
- [x] Add failing transition tests with an injected observer factory and fake registration seam; retain the real Win32 collision-preservation regression.
- [x] Cover chord→chord, chord→Double Ctrl, Double Ctrl→chord, Double Ctrl→Double Alt without duplicate hook, FunctionKey→chord, chord→FunctionKey, FunctionKey→DoubleModifier, DoubleModifier→FunctionKey, NativeHost dispose, hook-install failure, and conflicting new registration while preserving the old active binding.
- [x] Preserve the register-new-before-unregister-old transaction for chord replacements. For cross-mode replacement, acquire the new mechanism first, release the old one only after acquisition succeeds, and roll back the new resource if releasing the old resource fails.
- [x] Keep runtime failures before persistence: existing App settings flow returns `HOTKEY_UNAVAILABLE` when replacement fails and persists only after successful activation; accepted/persisted contract remains the same string field.
- [x] Keep invalid/malformed stored binding handling within existing state validation/fallback behavior; do not bump the schema version. `LauncherStateStore` and Named Pipe validation both continue using `GlobalHotkeyService.TryParse`, now backed by the shared codec.
- [x] No Phase 4E isolated test-option parser change was needed; this task does not launch a resource sample.

**Verification:**
- [x] Run focused and full `WebTools.NativeHost.Checks`; 52/52 passed, including the existing real Win32 conflict-preservation test.
- [x] Run NativeHost Release build (0 warnings, 0 errors) and verify transactional tests leave no duplicate registration/hook after tested transitions and disposal.

## Task 5: Add Pending-Apply Settings UX, Custom Capture, and Focused Documentation

**Files:**
- Modify: `src/features/settings/SettingsView.vue`.
- Modify: `README.md` only in the Native Launcher hotkey feature bullet.
- Modify: `native/WebTools.NativeHost.Checks/Program.cs` only if a compatibility check is needed for wire values.

**Interfaces / contracts:**
- Settings presets stage serialized binding values locally; only Apply submits through the existing `window.desktop.updateSettings` API.
- The renderer formats the current canonical value for display but does not implement global keyboard listening, shortcut ownership, or double-tap detection.
- An unavailable request displays a clear conflict/unavailable message and continues displaying the NativeHost-accepted previous binding.

**Steps:**
- [x] Add UI groups labeled 常用组合 (Alt+Space, Ctrl+Space), 快速触发 (Double Ctrl, Double Alt), 功能键 (F1–F10 only), and 高级自定义 chord capture.
- [x] Preserve theme tokens, existing button styles, keyboard accessibility, and responsive layout; keep the startup setting row intact.
- [x] Keep capture limited to normal Ctrl/Alt/Shift/Win chords; special modes use explicit buttons and never infer double taps in Electron.
- [x] Preset selection and completed custom capture create a pending binding. Show 待应用 with Apply and Cancel controls; Cancel discards the draft without IPC or runtime changes.
- [x] Apply sends one existing settings update. On success display the binding returned by NativeHost; on failure preserve the accepted active binding and show generic conflict feedback.
- [x] Format the selected binding as `Alt + Space`, `双击 Ctrl`, or `F2` regardless of its storage form.
- [x] Replace the generic README feature description with a concise list of 常用组合, Double Ctrl/Alt, F1–F10, and advanced chords; note that availability depends on Windows/runtime conflicts.

**Verification:**
- [x] Run `npm run typecheck`, `npm test` (96/96), and `npm run build` after UI integration.
- Rendered Settings UI was not opened because there is no isolated dev profile configured; layout and real IPC interaction remain for manual acceptance.

## Task 6: Final Regression, Resource Sample, and Phase 4G-1 Closeout

**Files:**
- Modify: `docs/native-launcher-phase4g-final-validation.md`.
- Modify only task files above if verification exposes an in-scope defect.

**Interfaces / contracts:**
- Do not change the existing 4G-1 baseline measurements. Append the user-confirmed functional sanity result and final hotkey acceptance status separately.
- Distinguish automated results from USER CONFIRMED and NEEDS MANUAL VERIFICATION.

**Steps:**
- [x] Run `npm run typecheck`, `npm test` (96/96), `npm run build`, the NativeHost checks (52/52), and `git diff --check`.
- [x] Do not use the Phase 4E isolated resource-test mode as a production-baseline comparison. No production-equivalent safe post-change sample was available, so record `POST-HOTKEY RESOURCE SAMPLE — NOT MEASURED`; this does not block the feature.
- [x] Record the user-provided tray/hotkey/show-hide sanity as `USER CONFIRMED — PASS` and mark the Phase 4G-1 baseline acceptance complete, preserving the original metrics verbatim.
- [x] The user later confirmed the full real Windows Hotkey 2.0 manual matrix passed with no issues. Record `MANUAL WINDOWS ACCEPTANCE — USER CONFIRMED PASS`, `HOTKEY SYSTEM 2.0 COMPLETE`, `TARGETED REGRESSION PASS`, and `READY FOR PHASE 4G-2`; this closes Hotkey System 2.0 only and does not start Phase 4G-2.
- [x] Review final `git diff`, `git diff --stat`, and status. Preserve unrelated user work and do not commit/push/create a PR.

**Manual acceptance matrix — USER CONFIRMED PASS:**
- Alt+Space, Ctrl+Space, Double Ctrl, Double Alt, F1, F10, and one advanced chord from another application; stage, Apply, activate, hide/retrigger, then restart NativeHost and verify persistence.
- Cancel a pending binding and verify the active binding does not change; a failed Apply must leave the previous binding active.
- Ctrl+C / Ctrl+V, Ctrl+Shift+key, Alt+Tab, Alt+F4, and Alt menu navigation do not unexpectedly activate WebTools in DoubleModifier modes.
- A conflict leaves the prior binding active and displays unavailable feedback; switching DoubleModifier→chord removes the keyboard observer.

## Dependencies and Execution Order

`Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6`.

These tasks share one persisted hotkey contract and one registration lifecycle; keep them serial. No subagent split is recommended. Windows interaction remains manual acceptance; a post-change resource sample is optional and cannot use a non-production-equivalent test process as baseline evidence.

## Out of Scope

- Phase 4G-2 or any full search/hotkey stress, long-duration soak, cold-start benchmark, or memory optimization.
- Double Shift/Double Win, standalone F11/F12 FunctionKey modes, Electron `globalShortcut`, an always-on hook for normal chords, settings schema changes, new dependencies, installer changes, and unrelated search/Manager/tray changes.
- Commit, push, PR, merge, tag, or release.
