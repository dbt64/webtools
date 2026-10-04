import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Reuse the reviewed 5D isolation/identity/cleanup driver; run the extended catalog scenario.
const result = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./verify-phase5d-plugin-ui-smoke.mjs', import.meta.url)), ...process.argv.slice(2), '--phase5f'], { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
