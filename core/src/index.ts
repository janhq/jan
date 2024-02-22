/**
 * Export all types.
 * @module
 */
export * from './types/index'

/**
 * Export all routes
 */
export * from './api'

/**
 * Export Core module
 * @module
 */
export * from './core'

/**
 * Export Event module.
 * @module
 */
export * from './events'

/**
 * Export Filesystem module.
 * @module
 */
export * from './fs'

/**
 * Export Extension module.
 * @module
 */
export * from './extension'

/**
 * Export all base extensions.
 * @module
 */
export * from './extensions/index'

/**
 * Declare global object
 */
declare global {
  var core: any | undefined
}
