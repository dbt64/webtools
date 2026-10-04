# WebTools Phase 4G-6 — Final Production Closeout Plan

> **Status:** Complete. This plan records the final review and closeout only. The installer was not deployed and no later development phase was started.

**Goal:** Establish an auditable final NativeHost-first production candidate and closeout record using the already accepted Phase 4F–4G5 work without rewriting historical evidence or touching the live installation/profile.

**Baseline:** branch `codex/shared-ai-translation-2.0`; expected source checkpoint `4e9d326bab80153bf02a3d2be6925402e980bb24`; pnpm migration `9965f285207385085a3b3cb9f4ffed6f0226b1a5`; Phase 4G4 checkpoint `1f68fe0ccc916e33197a9ec19d42b58ef5da5161`.

## Constraints

- Preserve `D:\webtools`, `%APPDATA%\Nook`, credentials/SecretStore, startup registration, unrelated processes and the candidate installer; no install, upgrade, uninstall, or app shutdown.
- Do not modify product code absent a specific, reproducible closeout blocker. No new dependencies or feature work.
- Reuse Phase 4F–4G5 and pnpm acceptance only where source and artifact identity match. Keep historical results and the 4G5 initial environment-snapshot limitation explicit.
- Do not repeat the Phase 4G2 stress rounds, 4G3 lifecycle matrix, 4G4 Soak or physical UI acceptance.
- A current minimum install/typecheck/test/build regression is allowed. NativeHost/UpdateHelper checks are reused if product source identity matches the already verified candidate.
- Commit only this Phase 4G6 plan/report after reviewing the staged diff. Ordinary push to the current branch is allowed. No merge, PR, tag, release, or installer deployment.

## Execution Tasks

### Task 1 — Git checkpoint and historical evidence

- Verify branch, HEAD/upstream, fetch state, clean worktree, G4/G5/pnpm commit ancestry and upstream publication.
- Review the final G5 decisions, G4 source/resource evidence, G5 M-A–M-G evidence labels, Phase 4F installer record and prior Native Launcher architecture plans.
- Stop if history, upstream, or user changes cannot be established safely.

### Task 2 — Final architecture/source review

- Trace NativeHost startup, single-instance handling, tray/login startup, hotkey, WPF Launcher, search and Manager process controller.
- Trace Manager-only Electron entry, browser window close/reuse, IPC/preload boundary and exact Translation handoff.
- Check installer entry point, Manager path/layout, user-data/secret boundary, and test-mode isolation.
- Review pnpm package-manager pin, lockfile, scripts and package layout against the minimum migration boundary.
- Record only reproducible findings; no broad refactor.

### Task 3 — Production-candidate identity

- Rehash the Phase 4G5 candidate installer and compare size/hash with the locked values.
- Hash staged NativeHost EXE/DLL, Manager EXE and ASAR; compare to G5 smoke identity.
- Inspect product/file versions, installer configuration and payload path relationships; inspect installer contents when local tooling supports safe read-only extraction/listing.
- Check current source and packaging commits relative to the candidate’s recorded build identity. If artifact/source identity is not established, do not label the package a valid final candidate.

### Task 4 — Minimum regression

- Run `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm test`, and `pnpm run build`.
- Run `git diff --check`.
- Reuse NativeHost 55/55, UpdateHelper 10/10, package/install smoke and user-confirmed Windows gates if product source identity matches the already verified candidate.
- Do not rerun stress, soak, install, upgrade, uninstall, or GUI workflows.

### Task 5 — Final report and checkpoint

- Create `docs/native-launcher-phase4g6-final-closeout.md` with source/Git identity, architecture, candidate hashes/layout, evidence classes, regressions, limitations, severity counts and final decision.
- Preserve all Phase 4G1–G5 measurements and the initial G5 snapshot limitation.
- Review plan/report diff and staged paths; ensure no evidence dump, generated artifact, profile or secret is staged.
- Commit the two Phase 4G6 documents and push normally to the current upstream. Verify remote/local SHA and clean worktree.

## Acceptance Gate

Mark complete only if the G5 checkpoint is pushed; source and installer/runtime hashes match the accepted candidate; the architecture and pnpm boundaries pass review; minimum regression passes; production data remains untouched; and there are no P0, P1 or blocking P2 findings. A non-blocking known evidence limitation must remain visible.

Expected terminal status if all gates pass:

`PHASE 4G-6 COMPLETE`

`FINAL PRODUCTION CLOSEOUT PASS`

`NATIVE LAUNCHER MIGRATION COMPLETE`

Stop after the closeout. This is candidate validation, not deployment or release publication.

## Execution Record — 2026-10-04

- Task 1: **PASS.** Current branch and upstream were `codex/shared-ai-translation-2.0`; pre-closeout HEAD was `4e9d326bab80153bf02a3d2be6925402e980bb24`; worktree was clean before this plan; G4 (`1f68fe0`), pnpm (`9965f28`) and G5 checkpoints were present and pushed (`HEAD...upstream = 0 0`).
- Task 2: **PASS WITH DEFERRED HARDENING NOTES.** NativeHost remains the WPF Launcher/tray/hotkey/startup owner; packaged Electron creates one on-demand Manager window and exits when that window closes. G4-to-current product source diff is empty. Existing `file:` main-frame navigation and same-user pipe peer authentication scope are documented as non-blocking follow-up hardening, not changed in this closeout.
- Task 3: **PASS.** Candidate installer and four staged runtime artifact hashes match the locked G5 values and packaged smoke manifest. NSIS configuration and staging layout identify NativeHost at install root and Manager under `Manager/`; the same exact installer hash was covered by G5 Windows acceptance. No installer was launched or extracted in this closeout.
- Task 4: **PASS.** `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm test` (118/118), and `pnpm run build` passed. The initial staged whitespace check found trailing Markdown hard-break spaces; after correction, `git diff --cached --check` passed. Existing NativeHost 55/55 and UpdateHelper 10/10 checks were reused because those product sources have not changed since their accepted run.
- Task 5: **PASS.** Final report added; only the Phase 4G-6 plan and report are staged for the closeout checkpoint. No profile, raw evidence, credential, or generated package is included.

The G5 missing initial environment snapshot remains explicitly recorded as a non-blocking evidence limitation. P0=0, P1=0, blocking P2=0.
