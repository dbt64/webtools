import {
  PluginValidationError,
  ManifestV2ValidationError,
  ManifestV3ValidationError,
  LIMITS_V2,
  LIMITS_V3,
  MANIFEST_VERSION_V2,
  MANIFEST_VERSION_V3,
  packPluginV1,
  packPluginV3,
  validatePluginArchiveV1,
  validatePluginArchiveV2,
  validatePluginArchiveV3,
  validatePluginSourceV1,
  validatePluginSourceV3,
  type PluginArchiveSummaryV1,
  type PluginArchiveSummaryV2,
  type PluginDiagnosticCodeV1,
  type PluginDiagnosticCodeV2,
  type PluginManifestV2,
  type PluginManifestV3,
  type PluginPackResultV1,
  type PluginPackResultV3,
  type PluginValidationResultV1,
} from '@webtools/plugin-sdk'

const sourceResult: Promise<PluginValidationResultV1> = validatePluginSourceV1('./plugin', '0.1.0')
const archiveResult: Promise<PluginArchiveSummaryV1> = validatePluginArchiveV1(new Uint8Array(), '0.1.0')
const v2ArchiveResult: Promise<PluginArchiveSummaryV2> = validatePluginArchiveV2(new Uint8Array(), '0.1.0')
const v3ArchiveResult = validatePluginArchiveV3(new Uint8Array(), '0.1.0')
declare const v2Summary: PluginArchiveSummaryV2
// @ts-expect-error validated archive descriptors are deeply immutable
v2Summary.manifest.features.push({ id: 'mutate', title: 'Mutate', commands: [], acceptedContexts: [], entry: { kind: 'web-bundle', document: 'index.html' }, requiredCapabilities: [], executionRequirements: { wasm: false } })
const packResult: Promise<PluginPackResultV1> = packPluginV1('./plugin', './dist/plugin.wtplugin', '0.1.0')
const packResultV3: Promise<PluginPackResultV3> = packPluginV3('./plugin-v3', './dist/plugin-v3.wtplugin', '0.1.0')
const sourceResultV3 = validatePluginSourceV3('./plugin-v3', '0.1.0')
const stableCode: PluginDiagnosticCodeV1 = 'INVALID_MANIFEST'
const validationError: typeof PluginValidationError = PluginValidationError
const manifestV2: PluginManifestV2 = {
  manifestVersion: MANIFEST_VERSION_V2,
  id: 'org.example.web',
  name: 'Example Web Feature',
  description: 'A declared web feature.',
  author: { name: 'Example' },
  version: '1.0.0',
  api: { apiMajor: 1, minHostVersion: '0.1.0' },
  type: 'feature-bundle',
  requestedCapabilities: [],
  features: [{ id: 'example.feature', title: 'Example', entry: { kind: 'web-bundle', document: 'index.html' } }],
  webBundle: { files: [{ path: 'index.html', mediaType: 'text/html' }] },
  network: { mode: 'none', domains: [] },
}
const v2Code: PluginDiagnosticCodeV2 = 'UNKNOWN_FIELD'
const v2ValidationError: typeof ManifestV2ValidationError = ManifestV2ValidationError
const maxArchiveBytes: number = LIMITS_V2.archive
const manifestV3: PluginManifestV3 = {
  manifestVersion: MANIFEST_VERSION_V3, id: 'org.example.runtime', name: 'Runtime Plugin', description: '', author: { name: 'Example' },
  version: '1.0.0', api: { apiMajor: 1, minHostVersion: '0.1.0' }, type: 'plugin', requestedCapabilities: [],
  runtime: { kind: 'node', preload: 'runtime/preload.cjs' }, compatibility: { platforms: ['win32'], architectures: ['x64'], nodeAbi: '137' },
  features: [{ id: 'home', title: 'Home', entry: { kind: 'web-bundle', document: 'web/index.html' } }],
  runtimeFiles: [{ path: 'web/index.html', role: 'web', mediaType: 'text/html' }, { path: 'runtime/preload.cjs', role: 'node-preload', mediaType: 'text/javascript' }],
  dependencies: [], package: { format: 'wtplugin', packageVersion: 1 },
}
const v3ValidationError: typeof ManifestV3ValidationError = ManifestV3ValidationError
const maxRuntimeArchiveBytes: number = LIMITS_V3.archive

void [sourceResult, archiveResult, v2ArchiveResult, v3ArchiveResult, packResult, packResultV3, sourceResultV3, stableCode, validationError, manifestV2, v2Code, v2ValidationError, maxArchiveBytes, manifestV3, v3ValidationError, maxRuntimeArchiveBytes]
