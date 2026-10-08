import {
  PluginValidationError,
  ManifestV2ValidationError,
  LIMITS_V2,
  MANIFEST_VERSION_V2,
  packPluginV1,
  validatePluginArchiveV1,
  validatePluginArchiveV2,
  validatePluginSourceV1,
  type PluginArchiveSummaryV1,
  type PluginArchiveSummaryV2,
  type PluginDiagnosticCodeV1,
  type PluginDiagnosticCodeV2,
  type PluginManifestV2,
  type PluginPackResultV1,
  type PluginValidationResultV1,
} from '@webtools/plugin-sdk'

const sourceResult: Promise<PluginValidationResultV1> = validatePluginSourceV1('./plugin', '0.1.0')
const archiveResult: Promise<PluginArchiveSummaryV1> = validatePluginArchiveV1(new Uint8Array(), '0.1.0')
const v2ArchiveResult: Promise<PluginArchiveSummaryV2> = validatePluginArchiveV2(new Uint8Array(), '0.1.0')
declare const v2Summary: PluginArchiveSummaryV2
// @ts-expect-error validated archive descriptors are deeply immutable
v2Summary.manifest.features.push({ id: 'mutate', title: 'Mutate', commands: [], acceptedContexts: [], entry: { kind: 'web-bundle', document: 'index.html' }, requiredCapabilities: [], executionRequirements: { wasm: false } })
const packResult: Promise<PluginPackResultV1> = packPluginV1('./plugin', './dist/plugin.wtplugin', '0.1.0')
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

void [sourceResult, archiveResult, v2ArchiveResult, packResult, stableCode, validationError, manifestV2, v2Code, v2ValidationError, maxArchiveBytes]
