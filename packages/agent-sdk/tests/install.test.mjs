// Installing a runtime, against a manifest this test serves itself.
//
// Nothing here touches the network: an HTTP server on loopback publishes a
// manifest and a tarball this test builds with the same `tar` the installer
// uses, so the whole path - manifest, platform key, download, digest, extract,
// rename - runs for real. What is faked is only the channel.

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import test from 'node:test'

import {
  JanInstallError,
  PLATFORM_KEYS,
  binName,
  findRuntime,
  installRuntime,
  platformKey,
  runtimeRoot,
} from '../src/index.js'

const VERSION = '0.0.0-test'

// A tarball holding a `jan` that is executable and does nothing. The installer
// only has to put a binary there; whether it runs is the runtime's business.
async function makeArchive(dir, content = VERSION) {
  const staged = join(dir, 'staged')
  await mkdir(staged, { recursive: true })
  const name = binName()
  await writeFile(join(staged, name), `#!/bin/sh\necho ${content}\n`)
  const archive = join(dir, 'jan-runtime.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', staged, name])
  return archive
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

// A channel: `/manifest.json` and the artifact, counted so a cached install can
// be proved to have downloaded nothing.
async function channel({ archive, version = VERSION, digest, omitPlatform = false }) {
  const bytes = await readFile(archive)
  const entry = { url: '', sha256: digest ?? sha256(bytes) }
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    if (req.url === '/manifest.json') {
      entry.url = `http://127.0.0.1:${server.address().port}/jan-runtime.tar.gz`
      const platforms = { [platformKey()]: entry }
      if (omitPlatform) delete platforms[platformKey()]
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ version, pub_date: '2026-01-01T00:00:00.000Z', platforms }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': bytes.length })
    res.end(bytes)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}/manifest.json`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
    artifacts: () => requests.filter((path) => path !== '/manifest.json').length,
  }
}

test('a platform maps to the artifact the manifest publishes for it', () => {
  assert.equal(platformKey('darwin', 'arm64'), 'darwin-universal')
  assert.equal(platformKey('darwin', 'x64'), 'darwin-universal')
  assert.equal(platformKey('linux', 'x64'), 'linux-x86_64')
  assert.equal(platformKey('linux', 'arm64'), 'linux-aarch64')
  assert.equal(platformKey('win32', 'x64'), 'windows-x86_64')
  assert.equal(platformKey('win32', 'arm64'), 'windows-aarch64')
  assert.throws(() => platformKey('sunos', 'sparc'), (error) => {
    assert.ok(error instanceof JanInstallError)
    assert.match(error.message, /sunos\/sparc/)
    assert.match(error.message, /darwin-universal/)
    return true
  })
  for (const key of PLATFORM_KEYS) assert.match(binName(key), /^jan(\.exe)?$/)
})

test('an install lands a verified, executable binary and is cached after that', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jan-install-'))
  const source = await mkdtemp(join(tmpdir(), 'jan-install-src-'))
  const archive = await makeArchive(source)
  const published = await channel({ archive })
  try {
    const progress = []
    const installed = await installRuntime({
      manifestUrl: published.url,
      root,
      onProgress: (received, total) => progress.push([received, total]),
    })

    assert.equal(installed.version, VERSION)
    assert.equal(installed.platform, platformKey())
    assert.equal(installed.cached, false)
    // The digest is the archive's, which is what the manifest pins and what a
    // caller recomputes from the published artifact.
    assert.equal(installed.sha256, sha256(await readFile(archive)))
    assert.equal((await stat(installed.bin)).mode & 0o111, 0o111, 'the binary is executable')
    assert.ok(progress.length > 0, 'progress was reported')
    assert.equal(progress.at(-1)[0], progress.at(-1)[1])

    // The marker is what makes it findable without the network, and what the
    // next install reads instead of downloading again.
    const found = await findRuntime({ version: VERSION, root })
    assert.equal(found.bin, installed.bin)
    assert.equal(found.cached, true)
    assert.equal(found.sha256, installed.sha256)

    const before = published.requests.length
    const again = await installRuntime({ version: VERSION, manifestUrl: published.url, root })
    assert.equal(again.cached, true)
    assert.equal(published.requests.length, before, `a cached install fetches nothing: ${published.requests}`)
    assert.equal(published.artifacts(), 1, 'the artifact was downloaded once')

    // Pinned to what the manifest publishes, an install is a cache read.
    const pinned = await installRuntime({ version: VERSION, sha256: found.sha256, manifestUrl: published.url, root })
    assert.equal(pinned.cached, true)

    // And so is one that pins nothing: the manifest names the version already
    // installed, with the digest it was installed under.
    const unpinned = await installRuntime({ manifestUrl: published.url, root })
    assert.equal(unpinned.cached, true)
    assert.equal(unpinned.version, VERSION)
    assert.equal(published.artifacts(), 1, 'still one download for the whole test')
  } finally {
    await published.close()
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('a digest that does not match is an error, and leaves nothing behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jan-install-bad-'))
  const source = await mkdtemp(join(tmpdir(), 'jan-install-bad-src-'))
  const published = await channel({ archive: await makeArchive(source), digest: 'f'.repeat(64) })
  try {
    await assert.rejects(
      installRuntime({ manifestUrl: published.url, root }),
      (error) => {
        assert.ok(error instanceof JanInstallError)
        assert.equal(error.expected, 'f'.repeat(64))
        assert.notEqual(error.actual, error.expected)
        assert.match(error.message, /hashes to/)
        return true
      },
    )
    assert.equal(await findRuntime({ version: VERSION, root }), null)
    assert.deepEqual(readdirSync(join(root, VERSION)), [], 'no staged or published install survives')
  } finally {
    await published.close()
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('a version or digest that the manifest does not publish is refused, not substituted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jan-install-pin-'))
  const source = await mkdtemp(join(tmpdir(), 'jan-install-pin-src-'))
  const published = await channel({ archive: await makeArchive(source) })
  try {
    await assert.rejects(
      installRuntime({ version: '0.0.0-other', manifestUrl: published.url, root }),
      (error) => {
        assert.ok(error instanceof JanInstallError)
        assert.match(error.message, /publishes 0\.0\.0-test, not 0\.0\.0-other/)
        return true
      },
    )
    await assert.rejects(
      installRuntime({ sha256: 'a'.repeat(64), manifestUrl: published.url, root }),
      (error) => {
        assert.ok(error instanceof JanInstallError)
        assert.match(error.message, /not the a{64} this install pins/)
        return true
      },
    )
    assert.equal(published.artifacts(), 0, 'nothing was downloaded for a refused pin')
  } finally {
    await published.close()
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('a manifest without this platform is an error naming what it has', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jan-install-missing-'))
  const source = await mkdtemp(join(tmpdir(), 'jan-install-missing-src-'))
  const published = await channel({ archive: await makeArchive(source), omitPlatform: true })
  try {
    await assert.rejects(installRuntime({ manifestUrl: published.url, root }), (error) => {
      assert.ok(error instanceof JanInstallError)
      assert.match(error.message, new RegExp(`no entry for ${platformKey()}`))
      assert.equal(error.platform, platformKey())
      return true
    })
  } finally {
    await published.close()
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('a channel that republishes a version under a new digest installs again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jan-install-repub-'))
  const source = await mkdtemp(join(tmpdir(), 'jan-install-repub-src-'))
  const first = await channel({ archive: await makeArchive(source) })
  try {
    const installed = await installRuntime({ manifestUrl: first.url, root })
    assert.equal(installed.cached, false)

    // Same version, different bytes: the recorded digest is what tells the two
    // apart, so this is a re-install rather than a cache hit.
    const rebuilt = join(source, 'second')
    await mkdir(rebuilt, { recursive: true })
    const second = await channel({ archive: await makeArchive(rebuilt, 'replacement') })
    try {
      const again = await installRuntime({ manifestUrl: second.url, root })
      assert.equal(again.version, VERSION)
      assert.equal(again.cached, false, 'a republished digest is not the install on disk')
      assert.notEqual(again.sha256, installed.sha256)
      assert.equal(again.sha256, sha256(await readFile(join(rebuilt, 'jan-runtime.tar.gz'))))
      assert.equal(await readFile(installed.bin, 'utf8'), `#!/bin/sh\necho ${VERSION}\n`)
      assert.equal(await readFile(again.bin, 'utf8'), '#!/bin/sh\necho replacement\n')
    } finally {
      await second.close()
    }
  } finally {
    await first.close()
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('an archive that names a member outside the staging directory is refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jan-install-escape-'))
  const source = await mkdtemp(join(tmpdir(), 'jan-install-escape-src-'))
  // An absolute member: `tar -P` stores the path as given, which is the shape a
  // hostile channel would use. The listing is checked before anything is
  // extracted, so the install is refused rather than written outside the root.
  const outside = join(source, 'outside')
  await writeFile(outside, 'x')
  const archive = join(source, 'jan-runtime.tar.gz')
  execFileSync('tar', ['-czPf', archive, outside])
  const published = await channel({ archive })
  try {
    await assert.rejects(installRuntime({ manifestUrl: published.url, root }), (error) => {
      assert.ok(error instanceof JanInstallError)
      assert.match(error.message, /member outside the install directory/)
      return true
    })
    assert.equal(await findRuntime({ version: VERSION, root }), null)
    assert.equal(readdirSync(join(root, VERSION)).length, 0, 'nothing is left staged')
  } finally {
    await published.close()
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('the runtime root follows JAN_AGENT_HOME, and a marker without a binary is not an install', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jan-install-root-'))
  try {
    assert.equal(runtimeRoot({ JAN_AGENT_HOME: root }), root)
    assert.notEqual(runtimeRoot({}), root)
    assert.match(runtimeRoot({}), /jan-agent[\\/]runtimes$/)

    // A directory that looks installed but holds no binary answers `null`: a
    // half-removed install must not be reported as usable.
    const dir = join(root, VERSION, platformKey())
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'install.json'), JSON.stringify({ version: VERSION, bin: binName() }))
    assert.equal(await findRuntime({ version: VERSION, root }), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent installs use isolated staging even within one clock tick', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jan-concurrent-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const published = await channel({ archive: await makeArchive(root) })
  t.after(published.close)
  t.mock.method(Date, 'now', () => 123)
  const installs = await Promise.all(Array.from({ length: 4 }, () =>
    installRuntime({ root, manifestUrl: published.url })))
  for (const installed of installs) {
    assert.equal(await readFile(installed.bin, 'utf8'), `#!/bin/sh\necho ${VERSION}\n`)
  }
  const found = await findRuntime({ root, version: VERSION })
  assert.equal(await readFile(found.bin, 'utf8'), `#!/bin/sh\necho ${VERSION}\n`)
})

test('relative cache roots return runnable absolute binary paths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jan-relative-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const published = await channel({ archive: await makeArchive(root) })
  t.after(published.close)
  const installed = await installRuntime({ root: relative(process.cwd(), root), manifestUrl: published.url })
  assert.equal(isAbsolute(installed.bin), true)
  assert.equal(await readFile(installed.bin, 'utf8'), `#!/bin/sh\necho ${VERSION}\n`)
})

test('untrusted version paths are refused before downloading', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jan-version-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const published = await channel({ archive: await makeArchive(root), version: '../escaped' })
  t.after(published.close)
  await assert.rejects(installRuntime({ root: join(root, 'cache'), manifestUrl: published.url }), JanInstallError)
  assert.equal(published.artifacts(), 0)
})
