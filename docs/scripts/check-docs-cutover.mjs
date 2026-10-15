#!/usr/bin/env node
// Run from any directory. Optional origin validates every rule through Pages.
// node docs/scripts/check-docs-cutover.mjs [http://localhost:8813]
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const parse = (text) => text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => {
  const [from, to, status] = l.trim().split(/\s+/)
  return { from, to, status: Number(status) }
})
const current = parse(readFileSync(new URL('../_redirects', import.meta.url), 'utf8'))
// Keep an immutable pre-cutover baseline so this check still works after merge.
const previous = parse(execFileSync('git', ['show', '4bf195c73:docs/_redirects'], { cwd: root, encoding: 'utf8' }))
const match = (rule, path) => {
  if (!rule.from.includes('*')) return rule.from === path ? rule.to : null
  const [prefix, suffix] = rule.from.split('*')
  return path.startsWith(prefix) && path.endsWith(suffix)
    ? rule.to.replace(':splat', path.slice(prefix.length, suffix ? -suffix.length : undefined)) : null
}
const resolve = (rules, path) => {
  for (let n = 0; n < 10; n++) {
    const rule = rules.find((r) => match(r, path) !== null)
    if (!rule) return path
    const next = match(rule, path)
    if (/^https?:/.test(next)) return next
    assert.notEqual(next, path, `Redirect loop at ${path}`)
    path = next
  }
  throw Error(`Redirect chain too long: ${path}`)
}
assert.equal(new Set(current.map((r) => r.from)).size, current.length, 'Duplicate source rules')
assert.ok(current.every((r) => r.status >= 300 && r.status <= 399), 'Invalid redirect status')
assert.ok(current.every((r) => `${r.from} ${r.to} ${r.status}`.length <= 1000), 'Cloudflare line limit')
assert.ok(current.filter((r) => r.from.includes('*')).length <= 100, 'Cloudflare dynamic rule limit')
assert.ok(current.filter((r) => !r.from.includes('*')).length <= 2000, 'Cloudflare static rule limit')
for (const rule of previous) {
  const path = rule.from.replace('*', 'cutover-probe')
  const before = resolve(previous, path)
  if (before === '/docs' || before.startsWith('/docs/')) {
    assert.ok(resolve(current, path).startsWith('https://docs.jan.ai/'), `Lost docs redirect: ${path}`)
  } else {
    const after = resolve(current, path)
    assert.equal(after.replace(/^https:\/\/jan\.ai(?=\/)/, ''), before, `Changed marketing destination: ${path}`)
    const preserved = current.find((r) => r.from === rule.from)
    assert.equal(preserved?.to, rule.to, `Changed marketing rule: ${path}`)
    assert.equal(preserved?.status, rule.status, `Changed marketing status: ${path}`)
  }
}
const expected = {
  '/docs': 'https://docs.jan.ai/',
  '/docs/': 'https://docs.jan.ai/',
  '/docs/desktop/quickstart': 'https://docs.jan.ai/desktop/quickstart',
  '/docs/agent/sdk': 'https://docs.jan.ai/agent/adk',
  '/docs/desktop/mcp-examples/test': 'https://docs.jan.ai/desktop/mcp',
  '/docs/future-page': 'https://docs.jan.ai/future-page',
}
for (const [path, to] of Object.entries(expected)) assert.equal(resolve(current, path), to)
console.log(`PASS: ${current.length} rules within Pages limits; legacy docs moved; marketing destinations preserved`)
if (process.argv[2]) {
  for (const rule of current) {
    const path = rule.from.replace('*', 'cutover-probe')
    const response = await fetch(new URL(path, process.argv[2]), { redirect: 'manual' })
    assert.equal(response.status, rule.status, `${path}: unexpected status`)
    assert.equal(response.headers.get('location'), match(rule, path), `${path}: unexpected Location`)
  }
  for (const path of ['/', '/docs', '/docs/', '/docs/desktop/quickstart']) {
    const response = await fetch(new URL(path, process.argv[2]), { redirect: 'manual' })
    assert.equal(response.status, path === '/' ? 200 : 301, `${path}: existing asset precedence`)
  }
  console.log('PASS: all rules through Pages, including existing docs HTML assets; homepage still 200')
}
