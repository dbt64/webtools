import type { ResolveTranslationHandoffRequest, TranslationHandoffDisposition } from '../../src/shared/builtin-translation-contracts.ts'
import { IPC_CHANNELS, type IpcResult } from '../../src/shared/ipc.ts'
import type { BuiltinTranslationHandoff } from '../services/builtin-translation-handoff.ts'
import { fail, safePluginError } from '../plugins/errors.ts'
import type { IpcSenderContext } from './window-security.ts'

interface Dependencies {
  getHandoff(): BuiltinTranslationHandoff | null
  isManagerMainFrame(context: IpcSenderContext): boolean
}
type Handler = (event: IpcSenderContext, ...args: unknown[]) => Promise<IpcResult<unknown>>
const dispositions = new Set<TranslationHandoffDisposition>(['gate-presented', 'enable-and-open', 'applied', 'cancel'])

function token(value: unknown): ResolveTranslationHandoffRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('INVALID_HANDOFF')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 4 || Object.keys(input).some(key => !['requestId', 'generation', 'uiGeneration', 'disposition'].includes(key))
    || typeof input.requestId !== 'string' || input.requestId.length === 0 || input.requestId.length > 128
    || !Number.isSafeInteger(input.generation) || (input.generation as number) < 1
    || !Number.isSafeInteger(input.uiGeneration) || (input.uiGeneration as number) < 0
    || typeof input.disposition !== 'string' || !dispositions.has(input.disposition as TranslationHandoffDisposition)) return fail('INVALID_HANDOFF')
  return {
    requestId: input.requestId,
    generation: input.generation as number,
    uiGeneration: input.uiGeneration as number,
    disposition: input.disposition as TranslationHandoffDisposition,
  }
}

export function createBuiltinTranslationHandoffHandlers(deps: Dependencies): Record<string, Handler> {
  const guard = (count: number, action: (handoff: BuiltinTranslationHandoff, args: unknown[]) => Promise<unknown> | unknown): Handler => async (event, ...args) => {
    try {
      if (!deps.isManagerMainFrame(event)) fail('PERMISSION_DENIED')
      if (args.length !== count) fail('INVALID_INPUT')
      const handoff = deps.getHandoff(); if (!handoff) fail('OPERATION_FAILED')
      const data = await action(handoff, args)
      if (!deps.isManagerMainFrame(event) || deps.getHandoff() !== handoff) fail('SESSION_EXPIRED')
      return { ok: true, data }
    } catch (error) { return { ok: false, error: safePluginError(error) } }
  }
  return {
    [IPC_CHANNELS.builtinTranslationHandoffGet]: guard(0, handoff => handoff.getProjection()),
    [IPC_CHANNELS.builtinTranslationHandoffResolve]: guard(1, (handoff, args) => handoff.resolve(token(args[0]))),
  }
}

export function registerBuiltinTranslationHandoffHandlers(
  ipc: { handle(channel: string, handler: Handler): void; removeHandler(channel: string): void },
  deps: Dependencies,
): () => void {
  const handlers = createBuiltinTranslationHandoffHandlers(deps)
  for (const [channel, handler] of Object.entries(handlers)) ipc.handle(channel, handler)
  return () => { for (const channel of Object.keys(handlers)) ipc.removeHandler(channel) }
}
