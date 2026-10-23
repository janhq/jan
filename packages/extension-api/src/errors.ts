/**
 * Why a host call failed. The same codes travel over the worker RPC, so
 * extensions can branch on `code` wherever their code runs.
 */
export type ExtensionErrorCode =
  | 'E_PERMISSION'
  | 'E_INVALID_ARGS'
  | 'E_NOT_FOUND'
  | 'E_TIMEOUT'
  | 'E_CANCELLED'
  | 'E_DISPOSED'
  | 'E_TOO_LARGE'
  | 'E_INTERNAL'

/** An error raised by the host for a call through `ExtensionContext`. */
export class ExtensionError extends Error {
  readonly code: ExtensionErrorCode

  constructor(code: ExtensionErrorCode, message: string) {
    super(message)
    this.name = 'ExtensionError'
    this.code = code
  }
}
