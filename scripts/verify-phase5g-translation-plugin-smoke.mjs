import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Reuse the identity-checked Phase 5D packaged driver with the Phase 5G-specific lifecycle scenario.
const result = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./verify-phase5d-plugin-ui-smoke.mjs', import.meta.url)), ...process.argv.slice(2), '--phase5g'], { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
