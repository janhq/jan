#!/usr/bin/env node
/**
 * Offline redirect check (no network): simulates Cloudflare Pages `_redirects`
 * matching against the built site in out/.
 *
 * For every old URL - each page of the old jan.ai/docs (redirects/
 * old-docs-urls.txt) and each source path in redirects/legacy-jan.ai.txt that
 * used to end up in /docs - it starts at jan.ai with the hand-off rules
 * (redirects/jan.ai.txt), crosses to docs.jan.ai, applies public/_redirects,
 * and requires:
 *   - the final URL is a page that exists in out/ (or an external jan.ai URL)
 *   - at most 2 redirect hops (1 is the goal; the jan.ai splat + a docs.jan.ai
 *     rename is tolerated)
 * Both trailing-slash forms are checked.
 *
 *   yarn build && node scripts/check-redirects.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const OUT = path.join(ROOT, 'out')
if (!fs.existsSync(OUT)) {
  console.error('out/ missing: run `yarn build` first')
  process.exit(1)
}

function parse(file) {
  return fs
    .readFileSync(path.join(ROOT, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [from, to, status] = l.split(/\s+/)
      return { from, to, status: Number(status ?? 302) }
    })
}

const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

// Cloudflare: first matching rule wins; trailing slash is ignored for matching.
function match(rules, p) {
  const n = norm(p)
  for (const r of rules) {
    if (r.from.endsWith('/*')) {
      const base = r.from.slice(0, -2)
      if (n === base || n.startsWith(`${base}/`)) {
        const splat = n === base ? '' : n.slice(base.length + 1)
        return r.to.replace(':splat', splat)
      }
    } else if (norm(r.from) === n) return r.to
  }
  return null
}

const janRules = parse('redirects/jan.ai.txt')
const docsRules = parse('public/_redirects')

const exists = (p) => {
  const n = norm(p.split('#')[0])
  if (n === '/') return fs.existsSync(path.join(OUT, 'index.html'))
  return fs.existsSync(path.join(OUT, `${n}.html`)) || fs.existsSync(path.join(OUT, n, 'index.html'))
}

function follow(start) {
  let host = 'jan.ai'
  let p = start
  const hops = []
  for (let i = 0; i < 6; i++) {
    const to = match(host === 'jan.ai' ? janRules : docsRules, p)
    if (!to) break
    hops.push(to)
    const u = to.startsWith('http') ? new URL(to) : new URL(to, `https://${host}`)
    host = u.hostname
    p = u.pathname
    if (host !== 'jan.ai' && host !== 'docs.jan.ai') break
  }
  return { host, path: p, hops }
}

const starts = new Set(
  fs.readFileSync(path.join(ROOT, 'redirects/old-docs-urls.txt'), 'utf8').split('\n').filter(Boolean)
)
// Every legacy source that used to land in /docs.
for (const r of parse('redirects/legacy-jan.ai.txt')) {
  if (!r.to.startsWith('/docs')) continue
  starts.add(r.from.endsWith('/*') ? `${r.from.slice(0, -2)}/some-old-page` : r.from)
}

const failures = []
let checked = 0
for (const s of starts) {
  for (const variant of new Set([norm(s), `${norm(s)}/`])) {
    checked++
    const r = follow(variant)
    const chain = [variant, ...r.hops].join(' -> ')
    if (r.hops.length > 2) failures.push(`too many hops: ${chain}`)
    else if (r.host === 'docs.jan.ai' && !exists(r.path)) failures.push(`dead end: ${chain}`)
    else if (r.host === 'jan.ai' && r.hops.length === 0 && s.startsWith('/docs'))
      failures.push(`not redirected: ${variant}`)
  }
}

// Every docs.jan.ai rule must also land on a page.
for (const r of docsRules) {
  if (r.to.startsWith('http')) continue
  if (!exists(r.to)) failures.push(`docs.jan.ai rule to missing page: ${r.from} -> ${r.to}`)
}

console.log(`checked ${checked} URLs, ${janRules.length} jan.ai + ${docsRules.length} docs.jan.ai rules`)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('all redirects end on a live page')
