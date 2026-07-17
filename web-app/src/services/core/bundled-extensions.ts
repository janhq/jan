import type { BaseExtension } from '@janhq/core'
import type { ExtensionManifest } from '@/lib/extension'

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

// Lazily imported so the extension bundles are NOT part of the service-hub
// bootstrap graph; they load only when extensions are enumerated (after the
// hub is ready), matching the pre-bundling load order.
const ENTRIES: BundledEntry[] = [
  {
    load: () => import('@janhq/assistant-extension'),
    name: '@janhq/assistant-extension',
    productName: 'Jan Assistant',
    version: '1.0.2',
    description:
      'Powers the default AI assistant that works with all your installed models.',
  },
  {
    load: () => import('@janhq/conversational-extension'),
    name: '@janhq/conversational-extension',
    productName: 'Conversational',
    version: '1.0.0',
    description: 'Enables conversations and state persistence via your file system.',
    mobile: true,
  },
  {
    load: () => import('@janhq/download-extension'),
    name: '@janhq/download-extension',
    productName: 'Download Manager',
    version: '1.0.0',
    description: 'Download and manage files and AI models in Jan.',
  },
  {
    load: () => import('@janhq/llamacpp-extension'),
    name: '@janhq/llamacpp-extension',
    productName: 'llama.cpp Inference Engine',
    version: '1.0.1',
    description: 'This extension enables llama.cpp chat completion API calls',
  },
  {
    load: () => import('@janhq/rag-extension'),
    name: '@janhq/rag-extension',
    productName: 'RAG Tools',
    version: '0.1.0',
    description:
      'Registers RAG tools and orchestrates retrieval across parser, embeddings, and vector DB',
  },
  {
    load: () => import('@janhq/vector-db-extension'),
    name: '@janhq/vector-db-extension',
    productName: 'Vector DB',
    version: '0.1.0',
    description: 'Vector DB integration using sqlite-vec if available with linear fallback',
  },
]

// The MLX extension depends on @janhq/tauri-plugin-mlx-api, which only exists
// on macOS. IS_MACOS is a build-time constant, so this import() is dead-code
// eliminated on other platforms and never enters the bundle graph.
if (IS_MACOS) {
  ENTRIES.push({
    load: () => import('@janhq/mlx-extension'),
    name: '@janhq/mlx-extension',
    productName: 'MLX Inference Engine',
    version: '1.0.0',
    description: 'This extension enables MLX-Swift inference on Apple Silicon Macs',
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
