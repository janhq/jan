export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
])

// Audio formats accepted by the omni backend (mlx-vlm / mlx-audio) as
// `input_audio`. Restricted to mp3/wav: both are reliably decoded by the
// backend AND playable in the WebKit preview. Heavier/edge formats (FLAC, OGG)
// are intentionally excluded — FLAC can't be decoded by WebKit for in-app
// playback. Kept in sync with `audioMimeTypeFromExtension`.
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3',
  'wav',
])

export const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  // Documents
  'pdf',
  'docx',
  'txt',
  'md',
  'csv',
  'xlsx',
  'xls',
  'ods',
  'pptx',
  'html',
  'htm',
  // JavaScript / TypeScript
  'js',
  'mjs',
  'cjs',
  'ts',
  'mts',
  'cts',
  'jsx',
  'tsx',
  // Python
  'py',
  'pyw',
  'pyi',
  // C / C++
  'c',
  'h',
  'cpp',
  'cc',
  'cxx',
  'hpp',
  'hh',
  // Systems languages
  'rs',
  'go',
  'swift',
  'zig',
  // JVM languages
  'java',
  'kt',
  'kts',
  'scala',
  'groovy',
  // Scripting languages
  'rb',
  'php',
  'lua',
  'pl',
  'r',
  'jl',
  // .NET
  'cs',
  'fs',
  'vb',
  // Shell
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  // Web
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'astro',
  // Data / config formats
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'xml',
  'ini',
  'cfg',
  'conf',
  'env',
  // Query / markup
  'sql',
  'graphql',
  'gql',
  'tex',
  'rst',
  // Misc text
  'log',
  'diff',
  'patch',
])

const extensionFromPath = (path: string): string =>
  (path.split(/[\\/]/).pop()?.split('.').pop() || '').toLowerCase()

export type ClassifiedPaths = {
  images: string[]
  audio: string[]
  docs: string[]
  unsupported: string[]
}

export const classifyDroppedPaths = (
  paths: readonly string[]
): ClassifiedPaths => {
  const images: string[] = []
  const audio: string[] = []
  const docs: string[] = []
  const unsupported: string[] = []
  for (const p of paths) {
    const name = p.split(/[\\/]/).pop() ?? ''
    const ext = extensionFromPath(p)
    // Treat extensionless filenames (no dot in basename) as unsupported.
    if (!name.includes('.')) {
      unsupported.push(p)
      continue
    }
    if (IMAGE_EXTENSIONS.has(ext)) images.push(p)
    else if (AUDIO_EXTENSIONS.has(ext)) audio.push(p)
    else if (DOCUMENT_EXTENSIONS.has(ext)) docs.push(p)
    else unsupported.push(p)
  }
  return { images, audio, docs, unsupported }
}
