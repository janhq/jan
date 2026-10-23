import type { BaseExtension } from '@janhq/core'
import type { ExtensionManifest } from '@/lib/extension'
import * as assistant from '../../../../extensions/assistant-extension/package.json'
import * as conversational from '../../../../extensions/conversational-extension/package.json'
import * as download from '../../../../extensions/download-extension/package.json'
import * as llamacpp from '../../../../extensions/llamacpp-extension/package.json'
import * as rag from '../../../../extensions/rag-extension/package.json'
import * as vectorDb from '../../../../extensions/vector-db-extension/package.json'
import * as mlx from '../../../../extensions/mlx-extension/package.json'

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

// Manifest fields come from each package.json so they cannot drift. Each field
// is read off a namespace import (never the whole object) so the bundler keeps
// only these named exports and drops scripts, dependencies and the rest.
//
// Lazily imported so the extension bundles are NOT part of the service-hub
// bootstrap graph; they load only when extensions are enumerated (after the
// hub is ready), matching the pre-bundling load order.
const ENTRIES: BundledEntry[] = [
  {
    load: () => import('@janhq/assistant-extension'),
    name: assistant.name,
    productName: assistant.productName,
    version: assistant.version,
    description: assistant.description,
  },
  {
    load: () => import('@janhq/conversational-extension'),
    name: conversational.name,
    productName: conversational.productName,
    version: conversational.version,
    description: conversational.description,
    mobile: true,
  },
  {
    load: () => import('@janhq/download-extension'),
    name: download.name,
    productName: download.productName,
    version: download.version,
    description: download.description,
  },
  {
    load: () => import('@janhq/llamacpp-extension'),
    name: llamacpp.name,
    productName: llamacpp.productName,
    version: llamacpp.version,
    description: llamacpp.description,
  },
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

// The MLX extension depends on @janhq/tauri-plugin-mlx-api, which only exists
// on macOS. IS_MACOS is a build-time constant, so this import() is dead-code
// eliminated on other platforms and never enters the bundle graph.
if (IS_MACOS) {
  ENTRIES.push({
    load: () => import('@janhq/mlx-extension'),
    name: mlx.name,
    productName: mlx.productName,
    version: mlx.version,
    description: mlx.description,
  })
}

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
