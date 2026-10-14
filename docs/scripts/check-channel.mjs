import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const channel = process.env.DOCS_CHANNEL ?? 'stable'
assert.ok(['stable', 'nightly'].includes(channel), 'DOCS_CHANNEL must be stable or nightly')
const nightly = channel === 'nightly'
const origin = nightly ? 'https://docs-nightly.jan.ai' : 'https://docs.jan.ai'
const out = new URL('../out/', import.meta.url)
const robots = await readFile(new URL('robots.txt', out), 'utf8')
assert.ok(robots.includes(nightly ? 'Disallow: /' : 'Allow: /'), 'Incorrect crawler rule')
assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`), 'Incorrect robots sitemap URL')
const sitemap = await readFile(new URL('sitemap.xml', out), 'utf8')
const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])
assert.ok(locations.includes(origin), 'Home must appear in the sitemap')
assert.ok(locations.every((url) => url === origin || url.startsWith(`${origin}/`)), 'Wrong sitemap origin')

async function* htmlFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* htmlFiles(path)
    else if (entry.name.endsWith('.html')) yield path
  }
}

let pages = 0
let home = false
let docs = false
for await (const path of htmlFiles(out.pathname)) {
  const html = await readFile(path, 'utf8')
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)
  // Redirect stubs and the not-found page do not have canonical URLs.
  if (!canonical) continue
  const url = canonical[1]
  assert.ok(url === origin || url.startsWith(`${origin}/`), `Wrong canonical in ${path}: ${url}`)
  const robotsMeta = html.match(/<meta name="robots" content="([^"]+)"/)
  if (nightly) {
    assert.ok(robotsMeta?.[1].includes('noindex'), `Missing noindex in ${path}`)
    assert.ok(robotsMeta?.[1].includes('nofollow'), `Missing nofollow in ${path}`)
  } else if (robotsMeta?.[1].includes('noindex')) {
    assert.ok(!locations.includes(url), `Noindex page in sitemap: ${url}`)
  }
  assert.equal(html.includes('aria-label="Nightly documentation"'), nightly, `Incorrect banner in ${path}`)
  if (nightly) assert.ok(html.includes('href="https://docs.jan.ai"'), `Missing stable link in ${path}`)
  home ||= url === origin || url === `${origin}/`
  docs ||= url.startsWith(`${origin}/desktop/`) || url.startsWith(`${origin}/agent/`)
  if (html.includes('github.com/janhq/jan/blob/')) {
    assert.ok(html.includes(`github.com/janhq/jan/blob/${nightly ? 'main' : 'docs-stable'}/docs/content/`), `Wrong edit branch in ${path}`)
  }
  pages++
}
assert.ok(home && docs, 'Expected home and docs pages in the export')
console.log(`Channel checks passed: ${channel}, ${pages} canonical pages, ${locations.length} sitemap URLs`)
