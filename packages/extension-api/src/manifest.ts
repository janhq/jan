import type { Contributions } from './contributions.js'
import type { PermissionString } from './permissions.js'

export { validateManifest } from './validate.js'
export { isApiCompatible } from './semver.js'
export { API_VERSION } from './api-version.js'
export type * from './contributions.js'
export type { PermissionString, PermissionKind } from './permissions.js'

/** Proposed API groups an extension can opt into (built-in and dev only). */
export type ProposalName = 'chat'

/** The `jan` field of an extension's package.json. */
export interface JanManifest {
  /** `<publisher>.<name>`, lowercase, for example `acme.hello-provider`. */
  id: string
  /** A literal or `%key%` into `l10n`. */
  displayName: string
  description?: string
  publisher: string
  /** A caret range on this package's version, for example `^1.0.0`. */
  apiVersion: string
  /** Relative path to the worker bundle (IIFE assigning `JanExtension`). */
  main: string
  permissions: PermissionString[]
  proposals?: ProposalName[]
  contributes?: Contributions
  /** locale -> key -> text. `en` must hold every `%key%` used. */
  l10n?: Record<string, Record<string, string>>
}

/** A manifest that passed `validateManifest`, with its package identity. */
export interface ValidatedManifest extends JanManifest {
  name: string
  version: string
  /** `engines.jan` of the package: the app versions it supports. */
  engines?: { jan: string }
}

export interface ManifestError {
  /** Where the problem is, for example `jan.contributes.commands[1].id`. */
  path: string
  message: string
}

export type ValidationResult =
  | { ok: true; manifest: ValidatedManifest }
  | { ok: false; errors: ManifestError[] }
