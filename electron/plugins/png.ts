import { validatePngV1 } from '../../plugin-sdk/declarative-v1/runtime/png-v1.mjs'
import { fail } from './errors.ts'

export function validatePng(bytes: Buffer): void {
  try { validatePngV1(bytes) }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    return fail(code === 'INVALID_INPUT' ? 'INVALID_INPUT' : 'INVALID_PACKAGE')
  }
}
