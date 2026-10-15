#!/usr/bin/env node
// Run from any directory; offline by default (fixtures require no Git history).
// node docs/scripts/check-docs-cutover.mjs [origin] [--live] [--out path]
// origin: optionally validate every rule through a running Pages server.
// --live: check all 77 concrete Stable destinations, robots and sitemap over HTTPS.
// --out path: optionally check ONLY this explicitly supplied marketing export's
// sitemap*.xml files exclude /docs, retain changelog and have local index children;
// never inspect an implicit/stale local out.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve as resolvePath, join } from 'node:path'

let origin, out, live = false
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]
  if (arg === '--live') live = true
  else if (arg === '--out') {
    out = process.argv[++i]
    assert.ok(out && !out.startsWith('--'), '--out requires a path')
  } else if (!arg.startsWith('-') && !origin) {
    origin = new URL(arg).href
  } else throw Error(`Unknown argument: ${arg}`)
}
const parse = (text) => text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => {
  const [from, to, status, extra] = l.trim().split(/\s+/)
  assert.ok(from && to && status && !extra, `Malformed rule: ${l}`)
  return { from, to, status: Number(status) }
})
const load = (name) => parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
const current = load('../_redirects')
const previous = load('./fixtures/pre-cutover-redirects.txt')
const handoff = load('./fixtures/expected-docs-handoff.txt')
const docsOrigin = 'https://docs.jan.ai'
const isDocs = (to) => to.startsWith(`${docsOrigin}/`)
const match = (rule, path) => {
  if (!rule.from.includes('*')) return rule.from === path ? rule.to : null
  const [prefix, suffix] = rule.from.split('*')
  return path.startsWith(prefix) && path.endsWith(suffix)
    ? rule.to.replace(':splat', path.slice(prefix.length, suffix ? -suffix.length : undefined)) : null
}
const first = (rules, path) => rules.find((r) => match(r, path) !== null)
const resolve = (rules, path) => {
  const seen = new Set()
  for (let n = 0; n < 10; n++) {
    assert.ok(!seen.has(path), `Redirect loop at ${path}`)
    seen.add(path)
    const rule = first(rules, path)
    if (!rule) return path
    const next = match(rule, path)
    if (/^https?:/.test(next)) return next
    path = next
  }
  throw Error(`Redirect chain too long: ${path}`)
}
const probes = (rule) => rule.from.includes('*')
  ? ['', 'cutover-probe', 'nested/cutover-probe', 'nested/cutover-probe/'].map((s) => rule.from.replace('*', s))
  : [rule.from]
assert.equal(new Set(current.map((r) => r.from)).size, current.length, 'Duplicate source rules')
assert.ok(current.every((r) => r.status >= 300 && r.status <= 399), 'Invalid redirect status')
assert.ok(current.every((r) => `${r.from} ${r.to} ${r.status}`.length <= 1000), 'Cloudflare line limit')
assert.ok(current.filter((r) => r.from.includes('*')).length <= 100, 'Cloudflare dynamic rule limit')
assert.ok(current.filter((r) => !r.from.includes('*')).length <= 2000, 'Cloudflare static rule limit')
const expectedDocs = handoff.filter((r) => isDocs(r.to))
for (const rule of expectedDocs) {
  const actual = current.find((r) => r.from === rule.from)
  assert.deepEqual(actual, { ...rule, status: 301 }, `Changed docs handoff rule: ${rule.from}`)
  for (const path of probes(rule)) {
    // Specific static rules may override a splat: compare first-match semantics.
    const expected = first(handoff, path)
    assert.equal(first(current, path)?.status, 301, `Docs status: ${path}`)
    assert.equal(resolve(current, path), match(expected, path), `Docs destination: ${path}`)
  }
}
for (const rule of current.filter((r) => isDocs(r.to))) {
  assert.ok(expectedDocs.some((r) => r.from === rule.from), `Unexpected docs rule: ${rule.from}`)
}
for (const rule of previous) {
  for (const path of probes(rule)) {
    const before = resolve(previous, path)
    if (before === '/docs' || before.startsWith('/docs/')) {
      const expected = first(handoff, path)
      assert.ok(expected && isDocs(expected.to), `Missing handoff coverage: ${path}`)
      assert.equal(resolve(current, path), match(expected, path), `Lost legacy docs redirect: ${path}`)
      assert.equal(first(current, path)?.status, 301, `Legacy docs status: ${path}`)
    } else {
      // Generated slash aliases may canonicalize /changelog/ to /changelog;
      // the original marketing rule itself must still be preserved verbatim.
      const marketingPath = (value) => value.replace(/^https:\/\/jan\.ai(?=\/)/, '').replace(/\/+$/, '') || '/'
      assert.equal(marketingPath(resolve(current, path)), marketingPath(before), `Changed marketing destination: ${path}`)
      assert.deepEqual(current.find((r) => r.from === rule.from), rule, `Changed marketing override: ${rule.from}`)
    }
  }
}
console.log(`PASS: ${current.length} rules within Pages limits; exact docs handoff + 301s; marketing overrides preserved`)

const normalize = (value) => {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.href
}
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
if (out) {
  const files = []
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name)
      if (item.isDirectory()) walk(path)
      else if (/^sitemap.*\.xml$/.test(item.name)) files.push(path)
    }
  }
  walk(resolvePath(out))
  assert.ok(files.length, `No sitemap XML files in --out ${out}`)
  const exportRoot = resolvePath(out)
  const indexed = new Set(), pages = new Set()
  const readLocalSitemap = (file) => {
    if (indexed.has(file)) return
    indexed.add(file)
    const xml = readFileSync(file, 'utf8')
    assert.match(xml, /<(sitemapindex|urlset)\b/, `Invalid marketing sitemap: ${file}`)
    const index = /<sitemapindex\b/.test(xml)
    for (const loc of locs(xml)) {
      const url = new URL(loc)
      assert.ok(!/^\/docs(?:\/|$)/.test(url.pathname), `Docs leaked into marketing sitemap: ${loc}`)
      assert.notEqual(url.hostname, 'docs.jan.ai', `Stable URL in marketing sitemap: ${loc}`)
      if (index) {
        const child = resolvePath(exportRoot, `.${decodeURIComponent(url.pathname)}`)
        assert.ok(child.startsWith(`${exportRoot}/`), `Sitemap child outside export: ${loc}`)
        // Reading the advertised local child is deliberate: an orphan public/
        // sitemap-0.xml must not hide a broken exported sitemap index.
        readLocalSitemap(child)
      } else pages.add(url.pathname.replace(/\/+$/, '') || '/')
    }
  }
  readLocalSitemap(join(exportRoot, 'sitemap.xml'))
  for (const file of files) readLocalSitemap(file)
  assert.ok(pages.has('/changelog'), 'Marketing sitemap lost /changelog')
  assert.ok([...pages].some((path) => path.startsWith('/changelog/')), 'Marketing sitemap lost changelog entries')
  console.log(`PASS: ${indexed.size} explicitly supplied marketing sitemap files: children exist, docs excluded, changelog retained`)
}

const fetchBounded = async (start) => {
  let url = start
  const seen = new Set()
  for (let n = 0; n <= 5; n++) {
    assert.ok(!seen.has(url), `Live redirect loop: ${url}`)
    seen.add(url)
    assert.equal(new URL(url).origin, docsOrigin, `Live redirect escaped Stable: ${url}`)
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      assert.ok(location, `Missing Location: ${url}`)
      await response.body?.cancel()
      url = new URL(location, url).href
      continue
    }
    assert.equal(response.status, 200, `Live status: ${url}`)
    return { response, url }
  }
  throw Error(`More than 5 live redirects: ${start}`)
}
const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1].toLowerCase(), m[2]]))
if (live) {
  // A constant splat destination is real; :splat expansions/probe URLs are not.
  const destinations = [...new Set(expectedDocs.map((r) => r.to).filter((to) => !to.includes(':splat')))]
  assert.equal(destinations.length, 77, 'Unexpected concrete destination inventory; review fixture')
  const { response: robotsResponse } = await fetchBounded(`${docsOrigin}/robots.txt`)
  const robots = await robotsResponse.text()
  assert.ok(!/noindex/i.test(robots), 'Stable robots contains noindex')
  const sitemapURLs = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1])
  assert.ok(sitemapURLs.some((u) => normalize(u) === `${docsOrigin}/sitemap.xml`), 'Stable robots must advertise its sitemap')
  const sitemap = new Set(), visited = new Set()
  const readSitemap = async (url) => {
    if (visited.has(url)) return
    assert.ok(visited.size < 20, 'Too many sitemap files')
    visited.add(url)
    const { response } = await fetchBounded(url)
    const xml = await response.text()
    assert.match(xml, /<(sitemapindex|urlset)\b/, `Invalid sitemap: ${url}`)
    if (/<sitemapindex\b/.test(xml)) for (const child of locs(xml)) await readSitemap(child)
    else for (const loc of locs(xml)) sitemap.add(normalize(loc))
  }
  for (const url of sitemapURLs) await readSitemap(url)
  // Extract wildcard-agent directives; use longest-match Allow/Disallow semantics.
  const groups = []
  let group = null
  for (const line of robots.split('\n')) {
    const m = line.replace(/#.*$/, '').trim().match(/^([\w-]+):\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase(), value = m[2].trim()
    if (key === 'user-agent') {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group) }
      group.agents.push(value.toLowerCase())
    } else if (group && ['allow', 'disallow'].includes(key) && value) group.rules.push({ key, value })
  }
  const robotRules = groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules)
  let completed = 0
  // Small batches avoid overwhelming Stable while keeping opt-in QA reasonably quick.
  for (let i = 0; i < destinations.length; i += 5) await Promise.all(destinations.slice(i, i + 5).map(async (destination) => {
    const { response, url } = await fetchBounded(destination)
    assert.match(response.headers.get('content-type') || '', /text\/html/i, `Not HTML: ${url}`)
    assert.ok(!/noindex|none/i.test(response.headers.get('x-robots-tag') || ''), `HTTP noindex: ${url}`)
    const html = await response.text()
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attributes(m[0]))
    const canonical = links.filter((a) => a.rel?.toLowerCase().split(/\s+/).includes('canonical'))
    assert.equal(canonical.length, 1, `Expected one canonical: ${url}`)
    assert.ok(canonical[0].href, `Missing canonical href: ${url}`)
    assert.equal(normalize(canonical[0].href), normalize(url), `Not self canonical: ${url}`)
    assert.equal(normalize(url), normalize(destination), `Unexpected final destination: ${destination}`)
    for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
      const a = attributes(m[0])
      if (/^(robots|googlebot|bingbot)$/i.test(a.name || '')) assert.ok(!/noindex|none/i.test(a.content || ''), `Meta noindex: ${url}`)
    }
    assert.ok(sitemap.has(normalize(canonical[0].href)), `Canonical missing from Stable sitemap: ${url}`)
    const path = new URL(url).pathname
    const applicable = robotRules.filter(({ value }) => {
      const pattern = value.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
      return new RegExp(`^${pattern}`).test(path)
    }).sort((a, b) => b.value.length - a.value.length || (a.key === 'allow' ? -1 : 1))
    assert.notEqual(applicable[0]?.key, 'disallow', `Stable robots blocks ${url}`)
    completed++
  }))
  console.log(`PASS: ${completed} concrete live destinations: bounded redirects, 200 HTML, indexable self canonicals, Stable robots + sitemap`)
}
if (origin) {
  for (const rule of current) {
    const path = rule.from.replace('*', 'cutover-probe')
    const response = await fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(30000) })
    assert.equal(response.status, rule.status, `${path}: unexpected status`)
    assert.equal(response.headers.get('location'), match(rule, path), `${path}: unexpected Location`)
    await response.body?.cancel()
  }
  for (const path of ['/', '/docs', '/docs/', '/docs/desktop/quickstart']) {
    const response = await fetch(new URL(path, origin), { redirect: 'manual' })
    assert.equal(response.status, path === '/' ? 200 : 301, `${path}: existing asset precedence`)
    await response.body?.cancel()
  }
  const query = await fetch(new URL('/docs/desktop/quickstart?utm_source=cutover&x=1', origin), { redirect: 'manual' })
  assert.equal(query.status, 301, 'Query redirect status')
  assert.equal(query.headers.get('location'), 'https://docs.jan.ai/desktop/quickstart?utm_source=cutover&x=1', 'Query parameters must survive migration')
  await query.body?.cancel()
  console.log('PASS: all rules through Pages, including existing docs HTML assets and query strings; homepage still 200')
}
