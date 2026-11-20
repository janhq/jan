import type {
  ExtensionModule,
  JanManifest,
  ValidatedManifest,
} from '@janhq/extension-api'
import type { BuiltinExtension } from '../builtins'

/** A minimal valid manifest; `jan` fields can be overridden per test. */
export function manifest(
  id: string,
  jan: Partial<JanManifest> = {}
): ValidatedManifest {
  return {
    name: `@test/${id}`,
    version: '1.0.0',
    id,
    displayName: id,
    publisher: 'Test',
    apiVersion: '^1.0.0',
    main: 'dist/index.js',
    permissions: [],
    ...jan,
  }
}

export function builtin(
  m: ValidatedManifest,
  mod: ExtensionModule,
  extra: Partial<Omit<BuiltinExtension, 'manifest' | 'load'>> = {}
): BuiltinExtension {
  return { manifest: m, load: async () => mod, ...extra }
}
