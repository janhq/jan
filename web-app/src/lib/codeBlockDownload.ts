/**
 * Tauri-only fix for the streamdown code-block download button.
 *
 * Streamdown's CodeBlockDownloadButton creates a Blob URL and clicks an
 * `<a download>` to save the file. WKWebView (macOS) and some Tauri
 * configurations on other platforms ignore the `download` attribute, so the
 * click silently does nothing. We intercept the click at the document level
 * and route it through Tauri's native save dialog + `write_file_sync`.
 */

import { invoke } from '@tauri-apps/api/core'

import { getServiceHub, isServiceHubInitialized } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'

const DOWNLOAD_BUTTON_SELECTOR =
  '[data-streamdown="code-block-download-button"]'
const CODE_BLOCK_SELECTOR = '[data-streamdown="code-block"]'
const CODE_BODY_SELECTOR = '[data-streamdown="code-block-body"]'

const LANG_TO_EXT: Record<string, string> = {
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  shellscript: 'sh',
  shellsession: 'sh',
  zsh: 'zsh',
  fish: 'fish',
  powershell: 'ps1',
  ps1: 'ps1',
  bat: 'bat',
  cmd: 'bat',
  python: 'py',
  py: 'py',
  ipython: 'py',
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  rust: 'rs',
  rs: 'rs',
  go: 'go',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  cxx: 'cpp',
  cc: 'cc',
  hpp: 'hpp',
  h: 'h',
  java: 'java',
  kotlin: 'kt',
  kt: 'kt',
  swift: 'swift',
  ruby: 'rb',
  rb: 'rb',
  php: 'php',
  html: 'html',
  xml: 'xml',
  svg: 'svg',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  json: 'json',
  jsonc: 'json',
  json5: 'json5',
  yaml: 'yaml',
  yml: 'yml',
  toml: 'toml',
  ini: 'ini',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  markdown: 'md',
  md: 'md',
  mdx: 'mdx',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  makefile: 'makefile',
  make: 'makefile',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  lua: 'lua',
  r: 'r',
  perl: 'pl',
  pl: 'pl',
  csharp: 'cs',
  cs: 'cs',
  fsharp: 'fs',
  scala: 'scala',
  haskell: 'hs',
  hs: 'hs',
  elixir: 'ex',
  ex: 'ex',
  erlang: 'erl',
  erl: 'erl',
  ocaml: 'ml',
  clojure: 'clj',
  clj: 'clj',
  dart: 'dart',
  groovy: 'groovy',
  nim: 'nim',
  zig: 'zig',
  v: 'v',
  julia: 'jl',
  jl: 'jl',
  diff: 'diff',
  patch: 'patch',
  text: 'txt',
  txt: 'txt',
}

type CodeBlockPayload = {
  code: string
  language: string
}

const DEFAULT_FILE_BASENAME = 'file'

/**
 * Turn a project name into a safe filename stem: strip path separators and
 * characters that are illegal on common filesystems, collapse whitespace, and
 * trim. Returns `null` when nothing usable remains.
 */
const sanitizeFileBaseName = (name: string): string | null => {
  const cleaned = name
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Default filename stem for a generated file. Uses the current thread's project
 * name when available so downloads land as e.g. `My Project.py` instead of the
 * generic `file.py`.
 */
const getDefaultFileBaseName = (): string => {
  try {
    const projectName =
      useThreads.getState().getCurrentThread()?.metadata?.project?.name
    if (typeof projectName === 'string') {
      return sanitizeFileBaseName(projectName) ?? DEFAULT_FILE_BASENAME
    }
  } catch (error) {
    console.debug('[code-block-download] could not resolve project name:', error)
  }
  return DEFAULT_FILE_BASENAME
}

const extractCodeBlockPayload = (
  button: Element,
): CodeBlockPayload | null => {
  const block = button.closest(CODE_BLOCK_SELECTOR)
  if (!block) return null

  const body = block.querySelector(CODE_BODY_SELECTOR)
  if (!body) return null

  const language = (
    body.getAttribute('data-language') ??
    block.getAttribute('data-language') ??
    'text'
  )
    .trim()
    .toLowerCase()

  const codeEl = body.querySelector('code')
  if (!codeEl) return null

  // Streamdown wraps each line in a direct-child `<span class="block ...">`,
  // so iterating direct children preserves line breaks. Fall back to plain
  // textContent if the structure ever changes.
  const lineNodes = Array.from(codeEl.children)
  const code =
    lineNodes.length > 0
      ? lineNodes.map((node) => node.textContent ?? '').join('\n')
      : (codeEl.textContent ?? '')

  return { code, language }
}

const downloadViaTauri = async (
  payload: CodeBlockPayload,
): Promise<void> => {
  const ext = LANG_TO_EXT[payload.language] ?? 'txt'
  const defaultPath = `${getDefaultFileBaseName()}.${ext}`

  if (!isServiceHubInitialized()) {
    console.warn('[code-block-download] ServiceHub not initialized yet')
    return
  }

  const dialog = getServiceHub().dialog()
  const targetPath = await dialog.save({
    defaultPath,
    filters: [
      {
        name: payload.language || 'Text',
        extensions: [ext],
      },
    ],
  })
  if (!targetPath) return

  await invoke('write_file_sync', {
    args: [targetPath, payload.code],
  })
}

let installed = false

/**
 * Install once at app boot. Safe to call repeatedly — subsequent calls are
 * no-ops.
 */
export const installCodeBlockDownloadHandler = (): void => {
  if (installed) return
  if (typeof document === 'undefined') return
  installed = true

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const button = target.closest(DOWNLOAD_BUTTON_SELECTOR)
      if (!button) return

      event.preventDefault()
      event.stopPropagation()

      const payload = extractCodeBlockPayload(button)
      if (!payload) {
        console.warn(
          '[code-block-download] could not extract code from block',
        )
        return
      }

      void downloadViaTauri(payload).catch((error) => {
        console.error('[code-block-download] save failed:', error)
      })
    },
    { capture: true },
  )
}
