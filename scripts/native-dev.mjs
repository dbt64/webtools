import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nativeProject = resolve(repositoryRoot, 'native/WebTools.NativeHost/WebTools.NativeHost.csproj')
const child = spawn('dotnet', ['run', '--project', nativeProject, '--', '--manager-dev'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, WEBTOOLS_MANAGER_DEV_ROOT: repositoryRoot, WEBTOOLS_NODE_EXECUTABLE: process.execPath },
})

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))

child.once('error', (error) => {
  process.stderr.write(`Unable to start Native Host development mode: ${error.message}\n`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
