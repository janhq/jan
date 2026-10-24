import type { BaseExtension } from '@janhq/core'
import type { ExtensionManifest } from '@/lib/extension'
import * as rag from '../../../../extensions/rag-extension/package.json'
import * as vectorDb from '../../../../extensions/vector-db-extension/package.json'

type ExtensionCtor = new (
  url: string,
  name: string,
  productName?: string,
  active?: boolean,
  description?: string,
  version?: string
) => BaseExtension

type BundledEntry = {
  load: () => Promise<{ default: ExtensionCtor }>
  name: string
  productName: string
  version: string
  description: string
  // Runs on mobile (no native plugin dependencies). Desktop-only otherwise.
  mobile?: boolean
}

// Legacy BaseExtension built-ins; the ones migrated to activate(ctx) are
// HOST_BUILTINS in lib/extensions/builtins.ts.
//
// Manifest fields come from each package.json so they cannot drift. Each field
// is read off a namespace import (never the whole object) so the bundler keeps
// only these named exports and drops scripts, dependencies and the rest.
//
// Lazily imported so the extension bundles are NOT part of the service-hub
// bootstrap graph; they load only when extensions are enumerated (after the
// hub is ready), matching the pre-bundling load order.
const ENTRIES: BundledEntry[] = [
  {
    load: () => import('@janhq/rag-extension'),
    name: rag.name,
    productName: rag.productName,
    version: rag.version,
    description: rag.description,
  },
  {
    load: () => import('@janhq/vector-db-extension'),
    name: vectorDb.name,
    productName: vectorDb.productName,
    version: vectorDb.version,
    description: vectorDb.description,
  },
]

export async function getBundledExtensions(
  opts: { mobile?: boolean } = {}
): Promise<ExtensionManifest[]> {
  const active = ENTRIES.filter((e) => (opts.mobile ? e.mobile : true))
  return Promise.all(
    active.map(async ({ load, name, productName, description, version }) => {
      const { default: Ctor } = await load()
      return {
        name,
        productName,
        url: 'built-in',
        active: true,
        description,
        version,
        extensionInstance: new Ctor(
          'built-in',
          name,
          productName,
          true,
          description,
          version
        ),
      }
    })
  )
}
