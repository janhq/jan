/**
 * The stable API for Jan desktop extensions. `./manifest` re-exports the
 * manifest types and validator for tooling that only lints package.json.
 */
export { API_VERSION } from './api-version.js'
export { DisposableStore, toDisposable, type Disposable } from './disposable.js'
export { Emitter, type Event } from './event.js'
export { ExtensionError, type ExtensionErrorCode } from './errors.js'
export {
  isLocalHost,
  isNetworkHost,
  isPermissionString,
  networkHostMatches,
  networkHostOf,
  type PermissionKind,
  type PermissionString,
} from './permissions.js'
export { isApiCompatible } from './semver.js'
export { validateManifest } from './validate.js'
export type * from './context.js'
export type * from './contributions.js'
export type {
  JanManifest,
  ManifestError,
  ProposalName,
  ValidatedManifest,
  ValidationResult,
} from './manifest.js'
