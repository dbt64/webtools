import { createHash, randomUUID } from 'node:crypto'
import { builtinModules, createRequire } from 'node:module'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { lstat, open, realpath, readdir, link, unlink, readFile } from 'node:fs/promises'
import { ManifestV3ValidationError, LIMITS_V3, parseManifestV3 } from '../runtime-v3/manifest-v3.mjs'
import { validatePackageV3 } from '../runtime-v3/package-v3.mjs'
import { inspectPeArchitecture } from '../runtime-v3/pe-architecture.mjs'
import { createDeterministicZipV3 } from '../runtime-v3/zip-writer-v3.mjs'
import { cleanupOwnedTempFile } from './owned-temp.mjs'

const CONTENT_TYPES = new Map([
  ['.js', 'text/javascript'], ['.mjs', 'text/javascript'], ['.cjs', 'text/javascript'], ['.json', 'application/json'],
  ['.wasm', 'application/wasm'],
])
const BUILTINS = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/u, '')]))

export class PluginPackV3Error extends Error {
  constructor(code, path = 'manifest.json') {
    super(`Plugin Runtime v3 package preparation failed (${code}).`)
    this.name = 'PluginPackV3Error'; this.code = code; this.path = path
  }
}
function reject(code, path) { throw new PluginPackV3Error(code, path) }
function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs }
function inside(root, candidate) { const rel = relative(root, candidate); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) }
function archivePath(value) {
  if (typeof value !== 'string' || !value || value.length > LIMITS_V3.pathScalars || value !== value.normalize('NFC')
    || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f?#:%]/u.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ')
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part) || /[<>"|*]/u.test(part))) reject('INVALID_PATH', value)
  return value
}
async function sourceRoot(directory) {
  if (typeof directory !== 'string' || !directory) reject('INVALID_INPUT')
  let info; let root
  try { info = await lstat(resolve(directory)); root = await realpath(resolve(directory)) } catch { reject('SOURCE_IO') }
  if (!info.isDirectory() || info.isSymbolicLink()) reject('SOURCE_IO')
  return root
}
async function readStableFile(filePath, maxBytes, containmentRoot) {
  let before; let actual
  try { before = await lstat(filePath); actual = await realpath(filePath) } catch { reject('SOURCE_IO') }
  if (before.isSymbolicLink() || !before.isFile() || !inside(containmentRoot, actual) || before.size > maxBytes) reject('SOURCE_IO')
  let handle
  try { handle = await open(filePath, 'r') } catch { reject('SOURCE_IO') }
  try {
    const opened = await handle.stat(); const current = await realpath(filePath)
    if (!opened.isFile() || !sameIdentity(before, opened) || current !== actual || !inside(containmentRoot, current)) reject('SOURCE_IO')
    const bytes = await handle.readFile(); const after = await handle.stat()
    if (bytes.length > maxBytes || !sameIdentity(opened, after)) reject('SOURCE_IO')
    return bytes
  } finally { await handle.close() }
}
async function readSourcePath(root, relativePath, maxBytes = LIMITS_V3.expanded) {
  const safe = archivePath(relativePath); const absolute = resolve(root, ...safe.split('/'))
  if (!inside(root, absolute)) reject('INVALID_PATH', safe)
  return readStableFile(absolute, maxBytes, root)
}
function mediaType(path) { return CONTENT_TYPES.get(extname(path).toLowerCase()) ?? 'application/octet-stream' }
const PE_MACHINE_BY_ARCH = Object.freeze({ x64: 0x8664, arm64: 0xaa64, ia32: 0x14c })
function safePackageMetadata(value, packageName) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.name !== packageName
    || typeof value.version !== 'string' || !value.version) reject('DEPENDENCY_INVALID', 'package.json')
  return value
}
async function resolvePackage(name, resolver, modulesRoot) {
  let lookupPaths
  try { lookupPaths = resolver.resolve.paths(name) ?? [] } catch { reject('DEPENDENCY_NOT_FOUND', name) }
  for (const lookupPath of lookupPaths) {
    if (!inside(modulesRoot, resolve(lookupPath))) continue
    const candidate = join(lookupPath, ...name.split('/'))
    let candidateInfo; let resolvedRoot
    try {
      candidateInfo = await lstat(candidate)
      resolvedRoot = await realpath(candidate)
    } catch { continue }
    if (candidateInfo.isSymbolicLink() && !inside(modulesRoot, resolvedRoot)) reject('UNSAFE_DEPENDENCY_LINK', name)
    if (!inside(modulesRoot, resolvedRoot) || !(await lstat(resolvedRoot)).isDirectory()) reject('UNSAFE_DEPENDENCY_LINK', name)
    try {
      const bytes = await readStableFile(join(resolvedRoot, 'package.json'), 1024 * 1024, modulesRoot)
      const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      if (metadata?.name === name) return { root: resolvedRoot, metadata: safePackageMetadata(metadata, name) }
    } catch (error) {
      if (error instanceof PluginPackV3Error && error.code !== 'SOURCE_IO') throw error
    }
  }
  reject('DEPENDENCY_NOT_FOUND', name)
}

function dependencyFields(metadata) {
  const declared = new Map()
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const value = metadata[field] ?? {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) reject('DEPENDENCY_INVALID', 'package.json')
    for (const [name, spec] of Object.entries(value)) {
      if (BUILTINS.has(name)) continue
      if (!/^(?:@[a-z0-9][a-z0-9._~-]{0,99}\/)?[a-z0-9][a-z0-9._~-]{0,99}$/u.test(name)) reject('DEPENDENCY_INVALID', 'package.json')
      archivePath(`node_modules/${name}/package.json`)
      if (typeof spec !== 'string' || !spec) reject('DEPENDENCY_INVALID', 'package.json')
      declared.set(name, { optional: field === 'optionalDependencies' || (field === 'peerDependencies' && metadata.peerDependenciesMeta?.[name]?.optional === true) })
    }
  }
  return [...declared].sort(([a], [b]) => a.localeCompare(b, 'en'))
}

export async function preparePluginV3(sourceDirectory, hostVersion, options = {}) {
  const root = await sourceRoot(sourceDirectory)
  const projectRoot = options.projectRoot === undefined ? root : await sourceRoot(options.projectRoot)
  const manifestBytes = await readSourcePath(root, 'manifest.json', LIMITS_V3.manifest)
  let untrusted
  const hostForSource = options.host ? { platform: options.host.platform, architecture: options.host.architecture } : undefined
  try { untrusted = parseManifestV3(manifestBytes, hostVersion, hostForSource).manifest } catch (error) {
    if (error instanceof ManifestV3ValidationError) throw error
    reject('INVALID_MANIFEST')
  }
  if (untrusted.dependencies.length || untrusted.runtimeFiles.some(file => ['dependency', 'native-addon'].includes(file.role))) reject('INVALID_FIELD', 'manifest.json')
  const entries = new Map(); const folded = new Set(); let expanded = 0
  const add = (archiveName, bytes, file) => {
    const path = archivePath(archiveName); const key = path.toLowerCase()
    if (entries.has(path) || folded.has(key)) reject('INVALID_PATH', path)
    if (entries.size + 2 > LIMITS_V3.entries || expanded + bytes.length > LIMITS_V3.expanded) reject('PACKAGE_LIMIT_EXCEEDED', path)
    folded.add(key); entries.set(path, { bytes: Buffer.from(bytes), file }); expanded += bytes.length
  }

  for (const file of untrusted.runtimeFiles) {
    const bytes = await readSourcePath(root, file.path, ['node-preload', 'node-command'].includes(file.role) ? LIMITS_V3.nodePreload : LIMITS_V3.expanded)
    add(file.path, bytes, file)
  }

  const dependencies = []; const warnings = []
  if (untrusted.runtime.kind === 'node') {
    let packageJson
    try { packageJson = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readSourcePath(projectRoot, 'package.json', 1024 * 1024))) }
    catch (error) { if (error instanceof PluginPackV3Error && error.code === 'SOURCE_IO') packageJson = {}; else reject('DEPENDENCY_INVALID', 'package.json') }
    const modulesPath = join(projectRoot, 'node_modules'); let modulesRoot
    try { modulesRoot = await realpath(modulesPath); if (!inside(projectRoot, modulesRoot)) reject('UNSAFE_DEPENDENCY_LINK', 'node_modules') }
    catch (error) { if (error instanceof PluginPackV3Error) throw error; if (dependencyFields(packageJson).length) reject('DEPENDENCY_NOT_FOUND', 'node_modules'); modulesRoot = projectRoot }
    const seenDestinations = new Map()
    async function materialize(name, requesterRoot, destination, ancestors, optional) {
      let resolver
      try { resolver = createRequire(join(requesterRoot, 'package.json')) } catch { reject('DEPENDENCY_INVALID', name) }
      let resolved
      try { resolved = await resolvePackage(name, resolver, modulesRoot) }
      catch (error) { if (optional && error?.code === 'DEPENDENCY_NOT_FOUND') { warnings.push({ code: 'OPTIONAL_DEPENDENCY_MISSING', dependency: name }); return }
        throw error }
      if (ancestors.some(ancestor => ancestor.root === resolved.root && ancestor.name === name && ancestor.version === resolved.metadata.version)) return
      const prior = seenDestinations.get(destination)
      if (prior) {
        if (prior.root !== resolved.root || prior.version !== resolved.metadata.version) reject('DEPENDENCY_COLLISION', destination)
        return
      }
      seenDestinations.set(destination, { root: resolved.root, name, version: resolved.metadata.version })
      const packageFiles = []
      const visit = async (sourceDir, relativeDir, stack) => {
        let names
        try { names = (await readdir(sourceDir)).sort((a, b) => a.localeCompare(b, 'en')) } catch { reject('SOURCE_IO', name) }
        for (const itemName of names) {
          if (itemName === 'node_modules') continue
          const sourcePath = join(sourceDir, itemName); const relativePath = relativeDir ? `${relativeDir}/${itemName}` : itemName
          const targetPath = archivePath(`${destination}/${relativePath}`)
          let info
          try { info = await lstat(sourcePath) } catch { reject('SOURCE_IO', targetPath) }
          if (info.isSymbolicLink()) {
            let target
            try { target = await realpath(sourcePath) } catch { reject('UNSAFE_DEPENDENCY_LINK', targetPath) }
            if (!inside(resolved.root, target)) reject('UNSAFE_DEPENDENCY_LINK', targetPath)
            const targetInfo = await lstat(target)
            if (targetInfo.isDirectory()) {
              if (stack.has(target)) reject('UNSAFE_DEPENDENCY_LINK', targetPath)
              await visit(target, relativePath, new Set([...stack, target]))
            } else if (targetInfo.isFile()) await addDependencyFile(target, targetPath, packageFiles, name)
            else reject('UNSAFE_DEPENDENCY_LINK', targetPath)
          } else if (info.isDirectory()) {
            if (stack.has(sourcePath)) reject('UNSAFE_DEPENDENCY_LINK', targetPath)
            await visit(sourcePath, relativePath, new Set([...stack, sourcePath]))
          } else if (info.isFile()) await addDependencyFile(sourcePath, targetPath, packageFiles, name)
          else reject('UNSAFE_DEPENDENCY_LINK', targetPath)
        }
      }
      await visit(resolved.root, '', new Set([resolved.root]))
      const packagePath = `${destination}/package.json`
      if (!packageFiles.includes(packagePath)) reject('DEPENDENCY_INVALID', packagePath)
      dependencies.push({ name, version: resolved.metadata.version, files: packageFiles.sort() })
      const nextAncestors = [...ancestors, { root: resolved.root, name, version: resolved.metadata.version }]
      for (const [child, childInfo] of dependencyFields(resolved.metadata)) {
        const nestedDestination = `${destination}/node_modules/${child}`
        await materialize(child, resolved.root, nestedDestination, nextAncestors, childInfo.optional)
      }
    }
    async function addDependencyFile(sourcePath, archiveName, packageFiles, packageName) {
      const ext = extname(archiveName).toLowerCase()
      const role = ext === '.node' ? 'native-addon' : 'dependency'
      const file = { path: archiveName, role, mediaType: mediaType(archiveName), dependency: packageName }
      const bytes = await readStableFile(sourcePath, LIMITS_V3.expanded, await realpath(dirname(sourcePath)))
      add(archiveName, bytes, file); packageFiles.push(archiveName)
    }
    const direct = dependencyFields(packageJson)
    for (const [name, dependency] of direct) await materialize(name, projectRoot, `node_modules/${name}`, [], dependency.optional)
  }

  if (entries.size + 1 > LIMITS_V3.entries) reject('PACKAGE_LIMIT_EXCEEDED')
  const runtimeFiles = [...entries.values()].map(item => item.file).sort((a, b) => a.path.localeCompare(b.path, 'en'))
  const compatibility = { ...untrusted.compatibility }
  const nativeAddons = runtimeFiles.filter(file => file.role === 'native-addon')
  if (nativeAddons.length) {
    const target = JSON.parse(await readFile(new URL('../runtime-target.json', import.meta.url), 'utf8'))
    const targetNodeAbi = options.host?.nodeAbi ?? target.nodeAbi
    if (compatibility.nodeAbi && compatibility.nodeAbi !== targetNodeAbi) reject('NATIVE_ABI_MISMATCH', 'compatibility.nodeAbi')
    if (!compatibility.nodeAbi) compatibility.nodeAbi = targetNodeAbi
  }
  const target = options.host ?? JSON.parse(await readFile(new URL('../runtime-target.json', import.meta.url), 'utf8'))
  const expectedMachine = PE_MACHINE_BY_ARCH[target.architecture]
  for (const [filePath, entry] of entries) {
    const extension = extname(filePath).toLowerCase()
    if (!['.node', '.dll', '.exe', '.com'].includes(extension)) continue
    const pe = inspectPeArchitecture(entry.bytes)
    const anyCpuResource = ['.dll', '.exe'].includes(extension) && pe?.anyCpuManaged === true
    if (pe && expectedMachine !== undefined && pe.machine !== expectedMachine && !anyCpuResource) reject('NATIVE_ARCH_MISMATCH', filePath)
  }
  const manifest = { ...JSON.parse(JSON.stringify(untrusted)), compatibility, runtimeFiles, dependencies: dependencies.sort((a, b) => a.files[0].localeCompare(b.files[0], 'en')) }
  const normalized = parseManifestV3(Buffer.from(JSON.stringify(manifest)), hostVersion, options.host).manifest
  const archive = createDeterministicZipV3([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(normalized)) },
    ...[...entries].map(([name, item]) => ({ name, data: item.bytes })),
  ])
  const validated = await validatePackageV3(archive, hostVersion, options.host)
  return { archive, manifest: validated.manifest, hash: validated.hash, size: validated.size, warnings }
}

export async function validatePluginSourceV3(sourceDirectory, hostVersion, options = {}) {
  const prepared = await preparePluginV3(sourceDirectory, hostVersion, options)
  return { valid: true, manifest: prepared.manifest, warnings: prepared.warnings }
}

export async function packPluginV3(sourceDirectory, outputFile, hostVersion, options = {}) {
  if (typeof outputFile !== 'string' || !outputFile || !/\.wtplugin$/iu.test(outputFile)) reject('OUTPUT_IO', 'package.wtplugin')
  const prepared = await preparePluginV3(sourceDirectory, hostVersion, options)
  const output = resolve(outputFile); const parent = dirname(output)
  let parentInfo; let parentReal
  try { parentInfo = await lstat(parent); parentReal = await realpath(parent) } catch { reject('OUTPUT_IO', 'package.wtplugin') }
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) reject('OUTPUT_IO', 'package.wtplugin')
  const finalPath = join(parentReal, basename(output))
  try { await lstat(finalPath); reject('OUTPUT_EXISTS', 'package.wtplugin') } catch (error) { if (error instanceof PluginPackV3Error) throw error; if (error?.code !== 'ENOENT') reject('OUTPUT_IO', 'package.wtplugin') }
  const tempPath = join(parentReal, `.webtools-plugin-v3-${process.pid}-${randomUUID()}.tmp`)
  let identity; let linkedFinal = false
  try {
    const handle = await open(tempPath, 'wx').catch(() => reject('OUTPUT_IO', 'package.wtplugin'))
    try { identity = await handle.stat(); await handle.writeFile(prepared.archive); await handle.sync(); identity = await handle.stat() } finally { await handle.close() }
    try { await link(tempPath, finalPath); linkedFinal = true } catch (error) { if (error?.code === 'EEXIST') reject('OUTPUT_EXISTS', 'package.wtplugin'); reject('OUTPUT_IO', 'package.wtplugin') }
    const result = await open(finalPath, 'r').catch(() => reject('OUTPUT_IO', 'package.wtplugin'))
    try {
      const current = await result.stat(); const bytes = await result.readFile()
      if (!sameIdentity(identity, current) || !bytes.equals(prepared.archive)) reject('OUTPUT_IO', 'package.wtplugin')
      const verified = await validatePackageV3(bytes, hostVersion, options.host)
      if (verified.hash !== prepared.hash) reject('OUTPUT_IO', 'package.wtplugin')
    } finally { await result.close() }
    return { valid: true, manifest: prepared.manifest, size: prepared.size, sha256: prepared.hash, warnings: prepared.warnings }
  } catch (error) {
    if (linkedFinal && identity) { try { const current = await lstat(finalPath); if (sameIdentity(identity, current)) await unlink(finalPath) } catch { /* Remove only the output created by this invocation. */ } }
    throw error
  } finally { await cleanupOwnedTempFile(tempPath, identity) }
}
