import { appendFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

/** Packaged-acceptance diagnostics. It is inert outside the isolated TEMP acceptance launch. */
export function tracePluginRuntimeAcceptance(event: string, details: Record<string, unknown> = {}): void {
  if (process.env.WEBTOOLS_PLUGIN_RUNTIME_ACCEPTANCE !== '1' || !process.argv.includes('--plugin-runtime-acceptance')) return
  const profile = process.env.WEBTOOLS_PLUGIN_RUNTIME_TEST_PROFILE
  if (!profile || !isAbsolute(profile)) return
  const relativeProfile = relative(resolve(tmpdir()), resolve(profile))
  if (!relativeProfile || relativeProfile === '..' || relativeProfile.startsWith(`..${sep}`) || isAbsolute(relativeProfile)) return
  try { appendFileSync(join(profile, 'plugin-runtime-main-flow.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), event, details })}\n`, 'utf8') }
  catch { /* Diagnostics must not affect runtime behavior. */ }
}
