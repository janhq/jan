#!/usr/bin/env node
/**
 * Generate redirect files from redirects/legacy-jan.ai.txt (the old jan.ai
 * `_redirects`) and the list of docs pages in content/.
 *
 *   public/_redirects     served by docs.jan.ai (Cloudflare Pages)
 *   redirects/jan.ai.txt  hand-off for janhq/jan.ai (#434): every jan.ai URL
 *                         that used to land in /docs now goes straight to its
 *                         final docs.jan.ai URL in ONE 301 (no chains)
 *
 * Rules:
 * - destinations are resolved through the legacy table until they stop
 *   moving, then mapped /docs/x -> docs.jan.ai/x
 * - a destination that is not a live docs page falls back to its section
 *   (/desktop, /agent) or the docs home, and is reported
 * - Cloudflare Pages matches paths with and without a trailing slash, so one
 *   rule per path is emitted (the old file listed both forms)
 * - static rules are emitted before splats (Cloudflare applies the first match)
 *
 *   node scripts/build-redirects.mjs [--check]   (--check: fail if files differ)
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DOCS_ORIGIN = 'https://docs.jan.ai'
const check = process.argv.includes('--check')

// ---- live pages -----------------------------------------------------------
const pages = new Set(['/'])
;(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/${e.name}`)
    else if (e.name.endsWith('.mdx')) {
      const slug = e.name === 'index.mdx' ? rel : `${rel}/${e.name.slice(0, -4)}`
      pages.add(slug || '/')
    }
  }
})(path.join(ROOT, 'content'), '')

// ---- legacy table -----------------------------------------------------------
const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const legacy = fs
  .readFileSync(path.join(ROOT, 'redirects/legacy-jan.ai.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [from, to] = l.split(/\s+/)
    return { from: norm(from), to: norm(to) }
  })

const staticMap = new Map()
const splats = []
for (const r of legacy) {
  if (r.from.endsWith('/*')) splats.push(r)
  else if (!staticMap.has(r.from)) staticMap.set(r.from, r.to)
}

const warnings = []

/** Follow legacy rules from a jan.ai path to where it finally lands on jan.ai. */
function resolveOnJanAi(p) {
  const seen = new Set()
  while (staticMap.has(p) && !seen.has(p)) {
    seen.add(p)
    p = staticMap.get(p)
  }
  return p
}

/** jan.ai path that lands in /docs -> final docs.jan.ai path (or null). */
function toDocsPath(janPath, from) {
  const landed = resolveOnJanAi(janPath)
  if (landed !== '/docs' && !landed.startsWith('/docs/')) return null
  const p = norm(landed.slice('/docs'.length) || '/')
  if (pages.has(p)) return p
  // Section fallback for pages that no longer exist.
  const section = ['/desktop', '/agent'].find((s) => p.startsWith(`${s}/`))
  const fallback = section ?? '/'
  warnings.push(`${from} -> ${p} (not a page) -> ${fallback}`)
  return fallback
}

// ---- docs.jan.ai: old /docs/* renames, without the prefix ---------------------
const docsRules = new Map()
for (const [from] of staticMap) {
  if (!from.startsWith('/docs/')) continue
  const docsFrom = from.slice('/docs'.length)
  if (pages.has(docsFrom)) continue // a live page now; no redirect
  const to = toDocsPath(from, from)
  if (to && to !== docsFrom) docsRules.set(docsFrom, to)
  else if (!to) {
    // Left /docs (e.g. /docs/privacy -> /privacy): send to jan.ai.
    docsRules.set(docsFrom, `https://jan.ai${resolveOnJanAi(from)}`)
  }
}
const docsSplats = []
for (const s of splats) {
  if (!s.from.startsWith('/docs/')) continue
  const to = s.to.startsWith('/docs') ? norm(s.to.slice('/docs'.length) || '/') : null
  docsSplats.push([s.from.slice('/docs'.length), to && (pages.has(to) ? to : '/')])
}

// ---- jan.ai hand-off ---------------------------------------------------------
const janRules = new Map()
// 1. Every legacy jan.ai rule whose final landing is in /docs.
for (const [from] of staticMap) {
  const to = toDocsPath(from, from)
  if (to) janRules.set(from, `${DOCS_ORIGIN}${to === '/' ? '/' : to}`)
}
// 2. Every live docs page at its old address.
for (const p of pages) {
  janRules.set(p === '/' ? '/docs' : `/docs${p}`, `${DOCS_ORIGIN}${p === '/' ? '/' : p}`)
}
const janSplats = []
for (const s of splats) {
  if (s.to.includes(':splat')) {
    // e.g. /guides/* -> /docs/:splat. The old paths under it don't exist on
    // docs.jan.ai, so send them to the docs home instead of a 404.
    if (s.to.startsWith('/docs')) janSplats.push([s.from, `${DOCS_ORIGIN}/`])
    continue
  }
  const to = toDocsPath(s.to, s.from)
  if (to) janSplats.push([s.from, `${DOCS_ORIGIN}${to === '/' ? '/' : to}`])
}
// 3. Catch-all last: anything else under /docs keeps its path.
janSplats.push(['/docs/*', `${DOCS_ORIGIN}/:splat`])

// ---- write -------------------------------------------------------------------
const pad = (s) => s.padEnd(56)
const fmt = (rules) => [...rules].sort(([a], [b]) => a.localeCompare(b)).map(([f, t]) => `${pad(f)} ${t} 301`)

const header = (what) => [
  `# GENERATED by scripts/build-redirects.mjs - do not edit by hand.`,
  `# Source: redirects/legacy-jan.ai.txt + content/. ${what}`,
  `# Static rules first, splats last (Cloudflare applies the first match).`,
  '',
]

const docsOut = [
  ...header('Served by docs.jan.ai.'),
  ...fmt(docsRules),
  '',
  ...docsSplats.filter(([, t]) => t).map(([f, t]) => `${pad(f)} ${t} 301`),
  '',
].join('\n')

const janOut = [
  ...header('Hand-off for janhq/jan.ai (#434): place ABOVE its other rules.'),
  ...fmt(janRules),
  '',
  ...janSplats.map(([f, t]) => `${pad(f)} ${t} 301`),
  '',
].join('\n')

const outputs = [
  [path.join(ROOT, 'public/_redirects'), docsOut],
  [path.join(ROOT, 'redirects/jan.ai.txt'), janOut],
]

let stale = false
for (const [file, content] of outputs) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (current !== content) {
    stale = true
    if (!check) fs.writeFileSync(file, content)
  }
}
console.log(
  `docs.jan.ai: ${docsRules.size} static + ${docsSplats.length} splat; jan.ai hand-off: ${janRules.size} static + ${janSplats.length} splat`
)
if (warnings.length) console.log(`fallbacks:\n  ${[...new Set(warnings)].join('\n  ')}`)
if (check && stale) {
  console.error('redirect files are out of date: run node scripts/build-redirects.mjs')
  process.exit(1)
}
