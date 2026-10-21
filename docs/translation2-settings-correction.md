# Translation 2.0 Settings and Entry Correction

Date: 2026-10-18

## Scope and current state

This correction implements the user's packaged-review feedback. The earlier development report and automated results did not establish that provider management was usable. The user explicitly directed immediate replacement of Legacy Manager Translation; the previous manual-acceptance prerequisite for entry-point cutover no longer applies.

Source, typecheck, Node regression, renderer build and isolated Electron functional acceptance pass. The corrected EXE was built successfully, with cover-install and Unicode/space-path install/self-uninstall checks passing. The earlier `package-20261018-185737` installer does not include these changes. No commit, push, production installation or production-profile reset was performed. User acceptance of the corrected installed version remains pending.

## Confirmed defects and changes

| Defect / evidence | Correction |
| --- | --- |
| Actual mounted Vue setup reproduced `DataCloneError` when hiding Google. The same `structuredClone(current)` pattern was used by sorting and service selection. | Unwrap reactive settings before cloning; serialize settings mutations so rapid changes do not overwrite each other. Import definitions and tab selections also cross IPC as plain data. |
| Settings rows used the catalog's constant order, so moving a provider could remain visually unchanged in the settings list. | Render website rows in saved order, as well as provider tabs. |
| Seven website controls were intentionally disabled by an implementation release-status condition, which did not satisfy the requested product controls. | All eight declared websites can be shown, hidden and reordered. Each gets its own lazy, isolated website view. A catalog entry or a successful page creation does not certify its live translation/autofill behavior. |
| AI provider/model labels interpolated arbitrary model configuration. Model validation accepted credential-shaped strings. | Reject credential-shaped model values; sanitize legacy model metadata on normalization and projection. Main additionally prevents the saved provider credential from being used as a model ID. No automatic movement of an invalid model value into credential storage. |
| The screenshot alone did not establish that SecretStore returned a key. Bootstrap's source was `getProviderInfo().model`; key projection was absent. | Keep model/configuration and credentials separate. Add an actual provider configuration form, saved-key status, draft-only password visibility, save/test controls and narrow authorized IPC. Credentials stay in the existing Main-owned AI credential store. Saved keys are not read back into the form. |
| The settings surface offered a JSON file importer in place of the planned preset service/key workflow. | Add an AI/DeepL service catalog. DeepL API Free/Pro accepts a named instance and API Key directly. JSON definitions remain an advanced option. |
| Imported data definitions could contain literal credentials in static fields or endpoint query parameters, which would be ordinary metadata. A regression test confirmed acceptance before the correction. | Reject credential fields and recognizable credential literals in those metadata positions. Validate an imported definition before previewing its endpoint in the UI. Credentials belong in the separate key field. |
| Every Google activation called `loadURL()` and awaited full navigation before accepting the tab selection. A stalled-load test reproduced blocked selection. | Show/select without waiting for remote load; reuse unchanged views; only changed input/languages cause navigation. Report load failure and offer retry. Readback is bounded; old selections and callbacks after close cannot restore a prior view. |
| Native translation commands and selected-text Feature invocation still called the Legacy Manager handoff. | Route them directly to the same dedicated Translation 2.0 window used by Plugin Center. Invalidate preview and cancel preceding translation work before opening; do not await a provider response to open the window. |
| In the real Electron process, closing Manager cancelled an independent Translation request. The functional regression failed before correction. | Manager close/navigation cancels Manager-owned connection tests only. Translation retains its own lifecycle. The independent surface is included in idle/queue ownership checks. |
| Restoring defaults from a website tab changed saved selection without deactivating its Main-owned website view. A handler regression reproduced the omission. | Deactivate the remote view before restoring defaults; the renderer first synchronizes source and returns to the native tab. |
| A pending machine-service test saved its original complete workspace after the response. Delayed-response regressions reproduced discarded website/selection changes and resurrected deleted services. | Atomically merge only test status into the latest workspace. A service revision invalidates results after a key edit; changed/deleted services cannot be marked passed or restored by a late response. Existing records without a revision remain compatible. |
| The left brand icon/title duplicated the tab/window identity. | Remove the Translation header brand block. |

## Service boundaries

- Supported AI configuration uses the existing registry: OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Qwen and Custom / OpenAI-compatible. Saving a provider does not silently change the platform's default provider. Translation has its own selected service.
- DeepL API Free and Pro are direct API services with dedicated authentication, language mapping and response parsing. They are distinct from the DeepL website tab. Multiple named instances are supported.
- MyMemory remains available. Google Cloud Translation and Microsoft Translator API are not presented as implemented preset adapters.
- JSON definition import is optional and bounded. It is not required to configure DeepL or OpenAI-compatible AI, and it does not promise compatibility with arbitrary API protocols.
- Website views retain sandboxing, isolation, separate ephemeral sessions, restricted navigation and denied permission/download/popup defaults. Website pages receive no WebTools preload or API credentials.
- Old Manager Translation UI, its gate/handoff module, Manager translation IPC and preload methods were removed. Shared AI, MyMemory and the existing Super Panel preview service/settings remain because they are adopted shared functionality. No user configuration or credential data was erased.

## Verification

The tests directory is `D:\SystemDefault\Desktop\webtoolstest\translation2-settings-fix-20261018`.

- `pnpm typecheck`: PASS (`typecheck-reviewed.log`).
- `pnpm test`: **682/682 PASS** (`node-tests-reviewed.log`). Historical 689-test results covered the previous Legacy UI/gate. Obsolete Legacy UI/handoff tests were retired and replaced by independent-window routing, configuration security, actual Vue settings interaction and dedicated API coverage; the counts are not directly comparable.
- `pnpm build`: PASS (`build-reviewed.log`).
- Isolated real Electron functional acceptance: **9 scenarios PASS**, with **3 controlled local API requests**. Evidence: `runtime-1792325688566/evidence.json`. This supersedes the earlier eight-scenario run; both evidence sets are retained.
- Actual DOM actions exercised website hide/show, all eight website tabs, row and tab ordering, AI configuration save/test, selected-provider translation, password input clearing, persistence after window close/reopen, the DeepL key form, and Manager close during translation.
- Settings and encrypted credential files in that isolated profile do not contain the controlled test key as plaintext. Bootstrap and rendered page text do not expose it.
- Google tab activation was **117ms** in that run. This measures the tab transition, not remote page readiness or completed translation. Switching back while the website was loading succeeded. Restoring defaults from the website returned to the native tab and content.
- The earlier Node run (`node-tests.log`) recorded one obsolete test still expecting Youdao to be unsupported. It was corrected to use an unknown provider. Failing-before-fix tests also established reactive cloning, credential-like model acceptance, slow navigation blocking and Manager-close cancellation; these intermediate failures are not treated as passes.
- Functional test-runner issues (awaiting an IPC response from a window it had just closed; clicking a still-disabled button before Vue's next render) were corrected in the disposable runner. They were not attributed to production defects.
- Final read-only review found the restore-defaults overlay and delayed service-test write defects above. Four regressions failed before the fixes and pass afterward. A first direct invocation without `--experimental-transform-types` could not load TypeScript parameter properties; rerunning through the project's configured runner established the actual RED results. No extra production change was made for that runner mismatch.
- `pnpm package:win`: PASS (`package-reviewed.log`): Node 682/682, NativeHost 72/72, UpdateHelper 10/10, self-contained publishing, EXE creation, same-directory cover-install, installed Manager discovery, Unicode/space installation and self-uninstall. These isolated installation checks do not certify the human Native-entry matrix.
- ASAR contains byte-identical copies of all 26 current compiled output files (`asar-evidence.json`). The first disposable verification attempt used POSIX paths with the Windows ASAR API; using native paths fixed the verifier without changing product files.

## Corrected installer

- Delivery: `D:\SystemDefault\Desktop\webtoolstest\translation2-settings-fix-20261018\installer-20261018-201518\WebTools-Setup-0.1.0-Translation-Settings-Fix.exe`
- Size: 191,689,726 bytes; file version `0.1.0.0`, product version `0.1.0`; unsigned.
- SHA256: `E75C6FE544B3E02882C94DA163960E944E4C9FA04AA8209694610CE60AB419A4`. Copied artifact hash matches the build output.
- Built from the existing dirty working tree at HEAD `707c5673dff479285b34a5b441bec9d3b725c737`; this is a user-test artifact, not a clean release candidate. Package metadata: `package-evidence.json` in the evidence directory.
- Existing build warnings: UIAutomation assembly resolution warnings and NSIS missing LegalCopyright metadata; build/check commands still exited successfully. No unrelated dependency changes were made to suppress them.

## Limits

No production credentials were read for testing or sent to a service. Paid/authenticated provider success is not established by the controlled local API. DeepL request/response and secret ownership were tested with controlled adapters; no real DeepL key was used. The eight website controls and view creation have coverage, but visible translation and automatic input behavior on every live remote site have not all been verified. Network availability and first-load website latency remain external conditions. The current user-installed binaries have not been replaced by this task; Native-entry testing on the corrected installation remains pending.

## Reference boundaries

The user's screenshots establish the desired service-selection → provider fields → API Key → test/save interaction. They do not justify adding paid-service features or copying all provider catalogs.

- [DeepL official translation API](https://developers.deepl.com/api-reference/translate/request-translation): request, `DeepL-Auth-Key`, language and result contracts for the dedicated adapter.
- [KISS Translator custom API documentation](https://github.com/fishjar/kiss-translator/blob/dev/custom-api_v2.md): API-shape differences and explicit language mapping; its executable hook/plugin mechanism is not adopted.
- [Immersive Translate advanced settings](https://immersivetranslate.com/zh-Hans/docs/advanced/): provider configuration reference. The supplied screenshots provide the direct UI comparison; no paid capability is added.
