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

// Cloudflare: static rules are applied before dynamic ones; within each group
// the first match wins. Static sources match literally (`/x` and `/x/` are
// different); splats match any path under the base.
function match(rules, p) {
  const n = norm(p)
  const ordered = [...rules.filter((r) => !r.from.includes('*')), ...rules.filter((r) => r.from.includes('*'))]
  for (const r of ordered) {
    if (r.from.endsWith('/*')) {
      const base = r.from.slice(0, -2)
      if (n === base || n.startsWith(`${base}/`)) {
        const splat = n === base ? '' : n.slice(base.length + 1)
        return r.to.replace(':splat', splat)
      }
    } else if (r.from === p) return r.to
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
    // Pages serves /x/ as a 308 to /x before page lookup; not a redirect hop
    // we control, so normalise only when no rule matched the literal path.
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

const failures = []

const starts = new Set(
  fs.readFileSync(path.join(ROOT, 'redirects/old-docs-urls.txt'), 'utf8').split('\n').filter(Boolean)
)
// Every legacy source that used to land in /docs. A splat that kept the path
// (/guides/* -> /docs/:splat) is tested with a real page under it, since an
// unknown path correctly ends on the docs.jan.ai 404 page, as it did before.
const SAMPLE_PAGE = 'desktop/quickstart'
for (const r of parse('redirects/legacy-jan.ai.txt')) {
  if (!r.to.startsWith('/docs')) continue
  if (!r.from.endsWith('/*')) starts.add(r.from)
  else starts.add(`${r.from.slice(0, -2)}/${r.to.includes(':splat') ? SAMPLE_PAGE : 'some-old-page'}`)
}

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

// The hand-off sits above jan.ai's own rules, so it must not change where a
// non-docs legacy rule lands (e.g. /guides/changelog/* -> /changelog/*).
const legacy = parse('redirects/legacy-jan.ai.txt')
for (const r of legacy) {
  if (r.to.startsWith('/docs')) continue
  const sample = r.from.endsWith('/*') ? `${r.from.slice(0, -2)}/some-old-page` : r.from
  const expected = r.from.endsWith('/*') ? r.to.replace(':splat', 'some-old-page') : r.to
  const got = match(janRules, sample)
  if (!got) continue // not handled by the hand-off: jan.ai's own rule applies
  const gotUrl = new URL(got, 'https://jan.ai')
  if (gotUrl.hostname !== 'jan.ai' || norm(gotUrl.pathname) !== norm(expected)) {
    failures.push(`hand-off overrides jan.ai rule: ${sample} should go to ${expected}, goes to ${got}`)
  }
}

// Cloudflare Pages limits and hygiene for both files.
const VALID_STATUS = new Set([301, 302, 303, 307, 308])
for (const [name, rules] of [['jan.ai.txt', janRules], ['_redirects', docsRules]]) {
  const dynamic = rules.filter((r) => r.from.includes('*') || r.from.includes(':'))
  if (rules.length - dynamic.length > 2000) failures.push(`${name}: more than 2000 static rules`)
  if (dynamic.length > 100) failures.push(`${name}: more than 100 dynamic rules`)
  const seen = new Set()
  for (const r of rules) {
    if (!VALID_STATUS.has(r.status)) failures.push(`${name}: bad status ${r.status} for ${r.from}`)
    if (`${r.from} ${r.to} ${r.status}`.length > 1000) failures.push(`${name}: line too long for ${r.from}`)
    if (seen.has(r.from)) failures.push(`${name}: duplicate source ${r.from}`)
    seen.add(r.from)
  }
}
// docs.jan.ai rules must not hide a live page.
for (const r of docsRules) {
  if (!r.from.includes('*') && exists(r.from)) failures.push(`_redirects: ${r.from} shadows a live page`)
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
