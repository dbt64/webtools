#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { realpath } from 'node:fs/promises'
import { stdin, stdout } from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPluginProject } from '../src/create-project.mjs'

const choices = {
  framework: ['vanilla', 'vue', 'react', 'svelte'],
  runtime: ['web', 'node'],
  packageManager: ['pnpm', 'npm'],
}
const help = `Create a WebTools Manifest v3 plugin\n\nUsage:\n  pnpm create webtools-plugin [directory] [options]\n\nOptions:\n  --framework <vanilla|vue|react|svelte>\n  --runtime <web|node>\n  --id <plugin-id>\n  --name <display-name>\n  --package-manager <pnpm|npm>\n  --yes                 use defaults for unanswered prompts\n  --help`

function parseArgs(argv) {
  const args = { directory: undefined, yes: false }
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]
    if (value === '--help' || value === '-h') return { help: true }
    if (value === '--yes' || value === '-y') { args.yes = true; continue }
    const option = ({ '--framework': 'framework', '--runtime': 'runtime', '--id': 'id', '--name': 'displayName', '--package-manager': 'packageManager' })[value]
    if (option) {
      const optionValue = argv[++i]
      if (!optionValue || optionValue.startsWith('--') || args[option] !== undefined) throw Object.assign(new Error(`Missing or duplicate value for ${value}.`), { code: 'CREATE_INVALID_INPUT' })
      if (choices[option] && !choices[option].includes(optionValue)) throw Object.assign(new Error(`Unsupported ${option}: ${optionValue}.`), { code: 'CREATE_INVALID_INPUT' })
      args[option] = optionValue
      continue
    }
    if (value.startsWith('-') || args.directory !== undefined) throw Object.assign(new Error(`Unexpected argument: ${value}.`), { code: 'CREATE_INVALID_INPUT' })
    args.directory = value
  }
  return args
}

async function choose(rl, label, allowed, fallback) {
  if (allowed.includes(fallback)) return fallback
  while (true) {
    const answer = (await rl.question(`${label} (${allowed.join('/')}) [${allowed[0]}]: `)).trim().toLowerCase() || allowed[0]
    if (allowed.includes(answer)) return answer
    stdout.write(`Choose one of: ${allowed.join(', ')}.\n`)
  }
}

export async function runCreateCli(argv = process.argv.slice(2), io = { stdin, stdout }) {
  let args
  try { args = parseArgs(argv) } catch (error) { io.stdout.write(`${error.message}\nRun with --help for usage.\n`); return 2 }
  if (args.help) { io.stdout.write(`${help}\n`); return 0 }
  const rl = io.stdin.isTTY ? createInterface({ input: io.stdin, output: io.stdout }) : undefined
  try {
    const directory = args.directory ?? (rl ? (await rl.question('Project directory [my-plugin]: ')).trim() || 'my-plugin' : 'my-plugin')
    const projectName = path.basename(directory.replace(/[\\/]$/u, '')) || 'my-plugin'
    const framework = args.framework ?? (rl ? await choose(rl, 'Framework', choices.framework, undefined) : 'vanilla')
    const runtime = args.runtime ?? (rl ? await choose(rl, 'Runtime', choices.runtime, undefined) : 'web')
    const packageManager = args.packageManager ?? (rl ? await choose(rl, 'Package manager', choices.packageManager, 'pnpm') : 'pnpm')
    const displayName = args.displayName ?? (rl ? (await rl.question(`Display name [${projectName}]: `)).trim() || projectName : projectName)
    const id = args.id ?? (rl ? (await rl.question(`Plugin ID [org.example.${projectName.toLowerCase().replace(/[^a-z0-9-]+/gu, '-') }]: `)).trim() || undefined : undefined)
    const result = await createPluginProject(directory, { projectName, framework, runtime, packageManager, displayName, id })
    io.stdout.write(`Created ${result.manifest.name} (${result.manifest.runtime.kind}/${framework}) in ${result.directory}.\n`)
    io.stdout.write(`Next: cd ${JSON.stringify(result.directory)}\n`)
    io.stdout.write(`Install the matching @webtools/plugin-sdk 1.6.0 tarball supplied with the WebTools developer tools, then run ${packageManager} install and ${packageManager} dev.\n`)
    io.stdout.write('This project is independent of the WebTools repository. The WebTools Host repeats authoritative validation on install.\n')
    return 0
  } catch (error) {
    const next = error.code === 'CREATE_OUTPUT_EXISTS' ? 'Choose a new directory; existing project files are never overwritten.'
      : error.code === 'CREATE_INVALID_INPUT' ? 'Check the project directory, plugin id, and selected options.'
        : 'Check the destination permissions and retry.'
    io.stdout.write(`[create-webtools-plugin] ${error.code ?? 'CREATE_FAILED'}: ${error.message} ${next}\n`)
    return 1
  } finally { rl?.close() }
}

const modulePath = await realpath(fileURLToPath(import.meta.url))
const invokedPath = process.argv[1] ? await realpath(path.resolve(process.argv[1])).catch(() => undefined) : undefined
const samePath = process.platform === 'win32'
  ? modulePath.toLowerCase() === invokedPath?.toLowerCase()
  : modulePath === invokedPath

if (samePath) {
  process.exitCode = await runCreateCli()
}
