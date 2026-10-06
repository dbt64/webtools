import {
  PluginValidationError,
  packPluginV1,
  validatePluginArchiveV1,
  validatePluginSourceV1,
  type PluginArchiveSummaryV1,
  type PluginDiagnosticCodeV1,
  type PluginPackResultV1,
  type PluginValidationResultV1,
} from '@webtools/plugin-sdk'

const sourceResult: Promise<PluginValidationResultV1> = validatePluginSourceV1('./plugin', '0.1.0')
const archiveResult: Promise<PluginArchiveSummaryV1> = validatePluginArchiveV1(new Uint8Array(), '0.1.0')
const packResult: Promise<PluginPackResultV1> = packPluginV1('./plugin', './dist/plugin.wtplugin', '0.1.0')
const stableCode: PluginDiagnosticCodeV1 = 'INVALID_MANIFEST'
const validationError: typeof PluginValidationError = PluginValidationError

void [sourceResult, archiveResult, packResult, stableCode, validationError]
