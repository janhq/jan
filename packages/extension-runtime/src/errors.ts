import { ExtensionError, type ExtensionErrorCode } from '@janhq/extension-api'

/** An error as it crosses the boundary: structured clone drops Error classes. */
export interface RpcError {
  code: ExtensionErrorCode
  message: string
}

const CODES: ReadonlySet<string> = new Set<ExtensionErrorCode>([
  'E_PERMISSION',
  'E_INVALID_ARGS',
  'E_NOT_FOUND',
  'E_TIMEOUT',
  'E_CANCELLED',
  'E_DISPOSED',
  'E_TOO_LARGE',
  'E_INTERNAL',
])

export function isErrorCode(value: unknown): value is ExtensionErrorCode {
  return typeof value === 'string' && CODES.has(value)
}

/**
 * The wire form of anything thrown by a handler. Only `ExtensionError` keeps
 * its code; anything else is an internal failure, so a stray `code` property
 * on a library error cannot impersonate a permission denial.
 */
export function toRpcError(error: unknown): RpcError {
  if (error instanceof ExtensionError)
    return { code: error.code, message: error.message }
  if (error instanceof Error) return { code: 'E_INTERNAL', message: error.message }
  return { code: 'E_INTERNAL', message: String(error) }
}

export function fromRpcError(error: RpcError): ExtensionError {
  return new ExtensionError(error.code, error.message)
}
