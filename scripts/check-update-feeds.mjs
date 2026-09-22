#!/usr/bin/env node
// Update-feed contract check.
//
// The in-app updater only fires when the release feed is well-formed: a semver
// version the plugin can compare, a manifest entry per shipped platform, and a
// URL + signature per entry. Any drift (a platform key renamed, a URL 404, a
// version shape the semver parser rejects) silently disables the prompt for
// part of the user base -- which is exactly the "old version never updates"
// bug class, and it is testable without installing anything.
//
// Modes:
//   node scripts/check-update-feeds.mjs [--fixtures]  check the committed
//       recordings under scripts/fixtures/update-feeds/ (the default). No
//       network; safe for per-PR runs. Re-record the fixtures when the feed
//       schema evolves.
//   node scripts/check-update-feeds.mjs --live     fetch the live feeds
//       (apps.jan.ai / delta.jan.ai) and additionally HEAD every asset URL.
//       For the nightly scheduled job, not for per-PR runs.
//
// The version-comparison invariants encode the channel trap: a nightly
// `0.8.4-<run>` is a semver PRERELEASE, i.e. strictly less than `0.8.4`. That
// is what keeps stable users from being offered nightlies and vice versa; if
// the comparison in this file disagrees with the updater's, the feed or the
// channels changed shape and both need a look.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(scriptDir, 'fixtures', 'update-feeds')

const FEEDS = [
  {
    name: 'stable',
    fixture: join(fixturesDir, 'stable.json'),
    live: 'https://apps.jan.ai/update-check',
    // windows-aarch64 is deliberately absent today; shipping a stable arm64
    // build must consciously extend this set.
    requiredPlatforms: ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64', 'linux-x86_64'],
  },
  {
    name: 'nightly',
    fixture: join(fixturesDir, 'nightly.json'),
    live: 'https://delta.jan.ai/nightly/latest.json',
    requiredPlatforms: [
      'darwin-aarch64',
      'darwin-x86_64',
      'windows-x86_64',
      'windows-aarch64',
      'linux-x86_64',
    ],
  },
]

const errors = []
const fail = (msg) => errors.push(msg)

// Minimal semver for the two shapes Jan ships: `x.y.z` and `x.y.z-<run>`.
// Returns a negative number if a < b, positive if a > b, 0 if equal.
function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(\w+))?$/.exec(v)
    if (!m) throw new Error(`unparseable version: ${v}`)
    return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null }
  }
  const pa = parse(a)
  const pb = parse(b)
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] - pb[k]
  }
  // Semver: a release (no prerelease) outranks any prerelease of the same
  // x.y.z; two numeric prereleases compare by number.
  if (pa.pre === null && pb.pre === null) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  const na = Number(pa.pre)
  const nb = Number(pb.pre)
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0
}

function checkFeed(feed, body) {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch (e) {
    fail(`${feed.name}: feed is not valid JSON (${e.message})`)
    return
  }
  if (typeof parsed.version !== 'string' || !parsed.version) {
    fail(`${feed.name}: missing or empty "version"`)
    return
  }
  try {
    compareVersions(parsed.version, parsed.version)
  } catch (e) {
    fail(`${feed.name}: version "${parsed.version}" is not semver-shaped (${e.message})`)
    return
  }
  if (Number.isNaN(Date.parse(parsed.pub_date ?? ''))) {
    fail(`${feed.name}: pub_date "${parsed.pub_date}" is not ISO-parseable`)
  }

  const platforms = parsed.platforms ?? {}
  for (const required of feed.requiredPlatforms) {
    const entry = platforms[required]
    if (!entry) {
      fail(`${feed.name}: required platform "${required}" missing from manifest`)
      continue
    }
    if (typeof entry.url !== 'string' || !entry.url.startsWith('https://')) {
      fail(`${feed.name}: ${required} url must be an https URL (got ${JSON.stringify(entry.url)})`)
    }
    if (typeof entry.signature !== 'string' || entry.signature.length < 32) {
      fail(`${feed.name}: ${required} signature missing or implausibly short`)
    }
  }
}

// Live-only: every advertised asset must actually resolve. A 404 here is the
// "update prompt installs nothing" bug one week after a CDN path change.
// HEAD is tried first; some CDN/WAF setups answer 403/405 to HEAD but serve
// GET fine, so a non-200 HEAD retries once with GET before failing — the
// check must not false-red on exactly the drift it exists to catch.
async function checkLiveAssets(feed, body) {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch (e) {
    fail(`${feed.name}: live body is not JSON (${e.message}); skipping asset probe`)
    return
  }
  const platformEntries = Object.entries(parsed.platforms ?? {})
  if (platformEntries.length === 0) {
    fail(`${feed.name}: live feed has no platforms at all`)
    return
  }
  for (const [platform, entry] of platformEntries) {
    let status
    try {
      status = await fetch(entry.url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      }).then((r) => r.status)
      if (status !== 200) {
        // Retry with GET; cancel the body so we do not pull the whole asset.
        status = await fetch(entry.url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        }).then((r) => {
          r.body?.cancel()
          return r.status
        })
      }
    } catch (e) {
      status = `network error: ${e.message}`
    }
    console.log(`  ${feed.name} ${platform}: ${status} ${entry.url}`)
    if (status !== 200) fail(`${feed.name}: ${platform} asset ${entry.url} -> ${status}`)
  }
}

const flags = process.argv.slice(2)
const unknown = flags.filter((f) => f !== '--live' && f !== '--fixtures')
if (unknown.length > 0) {
  // Rejected rather than ignored, because the silent failure is a false pass:
  // a mistyped `--live` in the nightly job would quietly run fixtures mode --
  // no network, no asset probes -- and report OK.
  console.error(`unknown argument(s): ${unknown.join(' ')}`)
  console.error('usage: check-update-feeds.mjs [--fixtures | --live]')
  process.exit(2)
}
const mode = flags.includes('--live') ? 'live' : 'fixtures'
console.log(`update-feed contract check (${mode} mode)`)

// The comparison invariants that keep channels from cross-offering updates.
// If any of these flip, the updater will offer stable builds to nightly users
// (or nothing at all to stable users) — the silent no-update bug.
const invariants = [
  ['0.8.4-4980', '0.8.4-4970', 1, 'newer nightly run outranks older'],
  ['0.8.4-4980', '0.8.4', -1, 'prerelease is less than its release (channel isolation)'],
  ['0.8.5', '0.8.4-4980', 1, 'next stable outranks any 0.8.4 nightly'],
  ['0.8.4', '0.8.4', 0, 'same version compares equal'],
  ['0.8.10', '0.8.9', 1, 'numeric compare across digit boundary, not lexicographic'],
]
for (const [a, b, expected, why] of invariants) {
  const got = compareVersions(a, b)
  const sign = Math.sign(got)
  if (sign !== expected) {
    fail(`version compare ${a} vs ${b}: expected sign ${expected} (${why}), got ${got}`)
  } else {
    console.log(`  cmp ${a} vs ${b} -> ${sign} ok (${why})`)
  }
}

for (const feed of FEEDS) {
  const body = readFileSync(feed.fixture, 'utf8')
  console.log(`checking ${feed.name} fixture`)
  checkFeed(feed, body)
}

if (mode === 'live') {
  for (const feed of FEEDS) {
    // Wrapped where every other fetch in this file already is: a DNS failure or
    // a refused connection here would otherwise surface as an unhandled
    // rejection and a stack trace instead of the curated failure report, which
    // is the one output a nightly job is read for.
    let res
    try {
      res = await fetch(feed.live, { signal: AbortSignal.timeout(15_000) })
    } catch (error) {
      fail(`${feed.name}: live feed ${feed.live} -> ${error.name}: ${error.message}`)
      continue
    }
    if (res.status !== 200) {
      fail(`${feed.name}: live feed ${feed.live} -> HTTP ${res.status}`)
      continue
    }
    const body = await res.text()
    console.log(`checking ${feed.name} live (${feed.live})`)
    checkFeed(feed, body)
    await checkLiveAssets(feed, body)
  }
}

if (errors.length > 0) {
  console.error(`\nFAILED (${errors.length}):`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log('\nOK: update feeds satisfy the contract')
