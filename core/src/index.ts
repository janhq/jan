/**
 * Export all types.
 * @module
 */
export * from './types'

/**
 * Export browser module
 * @module
 */
export * from './browser'

/**
 * Declare global object
 */
declare global {
  var core: any | undefined
}
