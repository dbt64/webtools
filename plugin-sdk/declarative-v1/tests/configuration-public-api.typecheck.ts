import type { PluginManifestV3 } from '@webtools/plugin-sdk'
import type { PluginConfiguration } from '@webtools/plugin-sdk/manifest'
import { connectWebTools } from '@webtools/plugin-sdk/web'
import type { CommandInvocation } from '@webtools/plugin-sdk/node'

const descriptor: PluginConfiguration = { schemaVersion: 1, settings: [{ key: 'count', label: 'Count', type: 'number', min: 1, max: 10, default: 2 }] }
declare const manifest: PluginManifestV3
manifest.configuration = descriptor
const web = connectWebTools()
const values: Promise<Readonly<Record<string, string | boolean | number>>> = web.config.get()
const saved: Promise<void> = web.config.set('count', 3)
declare const node: CommandInvocation
const nodeValues: typeof values = node.webtools.config.get()
const nodeSaved: Promise<void> = node.webtools.config.set('count', 3)
// @ts-expect-error config is not arbitrary JSON storage
web.config.set('count', { nested: 'value' })
// @ts-expect-error node uses the same primitive contract
node.webtools.config.set('count', ['value'])
void [values, saved, nodeValues, nodeSaved]
