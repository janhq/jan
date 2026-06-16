export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
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
  docs: string[]
  unsupported: string[]
}

export const classifyDroppedPaths = (
  paths: readonly string[]
): ClassifiedPaths => {
  const images: string[] = []
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
    else if (DOCUMENT_EXTENSIONS.has(ext)) docs.push(p)
    else unsupported.push(p)
  }
  return { images, docs, unsupported }
}
