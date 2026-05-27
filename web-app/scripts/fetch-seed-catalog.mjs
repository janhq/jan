#!/usr/bin/env node
/**
 * Prebuild step: download the latest curated model catalog snapshot from
 * `atomic-chat-model-catalog/dist/` on raw.githubusercontent.com and place
 * the gzipped files in `web-app/public/` so Vite bundles them as static
 * assets. The Atomic Chat client reads them at first launch to render a
 * full catalog instantly (offline, behind corporate proxies, on slow
 * networks, before the live raw.githubusercontent.com fetch resolves).
 *
 * Behaviour:
 *   - Tries the URL pair (catalog.json.gz + catalog.idx.json.gz) with a
 *     30 s timeout each.
 *   - On success: writes both files atomically to `web-app/public/`.
 *   - On failure (network down, 4xx, timeout): keeps any pre-existing
 *     seed files in place and exits 0. The build must NEVER fail because
 *     of a missing seed — the client's BASELINE_MODEL_CATALOG already
 *     guarantees a working first launch.
 *
 * Override the source URL via env vars (matches the runtime client):
 *   VITE_MODEL_CATALOG_URL          → .json suffix is rewritten to .json.gz
 *   VITE_MODEL_CATALOG_INDEX_URL    → .json suffix is rewritten to .json.gz
 */

import { mkdirSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, '..', 'public')

const DEFAULT_BASE =
  'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-model-catalog/main/dist'

const toGzipUrl = (envValue, defaultPath) => {
  const raw = envValue?.trim()
  if (raw) return raw.endsWith('.gz') ? raw : `${raw}.gz`
  return `${DEFAULT_BASE}/${defaultPath}.gz`
}

const CATALOG_URL = toGzipUrl(process.env.VITE_MODEL_CATALOG_URL, 'catalog.json')
const INDEX_URL = toGzipUrl(
  process.env.VITE_MODEL_CATALOG_INDEX_URL,
  'catalog.idx.json'
)

const FETCH_TIMEOUT_MS = 30_000

/**
 * Download `url` to `outPath` atomically (tmp-file + rename), failing if
 * the response is non-2xx or takes longer than `FETCH_TIMEOUT_MS`.
 */
const downloadAtomic = async (url, outPath) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/octet-stream' },
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.byteLength < 1024) {
      throw new Error(
        `Suspicious payload size (${buf.byteLength} bytes) — refusing to overwrite seed.`
      )
    }
    mkdirSync(dirname(outPath), { recursive: true })
    const tmpPath = `${outPath}.tmp`
    writeFileSync(tmpPath, buf)
    renameSync(tmpPath, outPath)
    return buf.byteLength
  } finally {
    clearTimeout(timer)
  }
}

const summarizeExisting = (path) => {
  if (!existsSync(path)) return null
  const st = statSync(path)
  return `${st.size} bytes, mtime=${st.mtime.toISOString()}`
}

const main = async () => {
  const targets = [
    {
      url: CATALOG_URL,
      out: join(PUBLIC_DIR, 'seed-catalog.json.gz'),
      label: 'catalog',
    },
    {
      url: INDEX_URL,
      out: join(PUBLIC_DIR, 'seed-catalog.idx.json.gz'),
      label: 'index',
    },
  ]

  let downloaded = 0
  let kept = 0
  for (const t of targets) {
    try {
      const size = await downloadAtomic(t.url, t.out)
      console.log(`[seed-catalog] ${t.label}: downloaded ${size} bytes → ${t.out}`)
      downloaded += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const existing = summarizeExisting(t.out)
      if (existing) {
        console.warn(
          `[seed-catalog] ${t.label}: download failed (${message}). Keeping existing seed (${existing}).`
        )
        kept += 1
      } else {
        console.warn(
          `[seed-catalog] ${t.label}: download failed (${message}). No prior seed; client will use BASELINE_MODEL_CATALOG.`
        )
      }
    }
  }

  console.log(
    `[seed-catalog] Done. Downloaded: ${downloaded}/2. Kept stale: ${kept}/2.`
  )
}

await main()
