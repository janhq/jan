// Installing a pinned Jan runtime, without a Rust toolchain and without Jan
// Desktop.
//
// The SDK spawns and owns a `jan` process, and where that process comes from is
// the caller's business: a PATH install, a build of their own, or this - the
// runtime Jan publishes, downloaded for this platform and checked against the
// digest the manifest carries.
//
// The manifest is the only source of truth, deliberately. It names, per
// platform, the artifact and its SHA-256; an install therefore reproduces the
// bytes that were advertised rather than whatever the URL serves today. A
// caller who names a `version` or a `sha256` is pinning: the install fails
// closed when the published manifest has moved on, which is the same rule the
// protocol applies to a session's model.
//
// An install is atomic: everything happens in a staging directory that is
// renamed into place only after the digest matches and the binary is there, so
// an interrupted or corrupt install never leaves something that looks usable.

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, lstat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// The channel the runtime is published on today. A release channel is the same
// shape at another URL, which is why the URL is an argument and this is only a
// default.
export const MANIFEST_URL = 'https://delta.jan.ai/agent-nightly/manifest.json'

// Every platform key the current manifest publishes. macOS is one universal
// artifact, so both of its architectures map to `darwin-universal`.
export const PLATFORM_KEYS = Object.freeze([
  'darwin-universal',
  'linux-x86_64',
  'linux-aarch64',
  'windows-x86_64',
  'windows-aarch64',
])

// Where a runtime could not be installed: no artifact for this platform, a
// manifest that does not name what was asked for, a digest that does not match,
// or an archive that does not hold a binary. Distinct from
// [`JanRuntimeError`](./index.js), which is a runtime that will not run - this
// is a runtime that could not be fetched.
export class JanInstallError extends Error {
  constructor(message, { url, expected, actual, platform } = {}) {
    super(message)
    this.name = 'JanInstallError'
    this.url = url
    this.expected = expected
    this.actual = actual
    this.platform = platform
  }
}

// The manifest key for a Node platform/arch pair. Throws rather than guessing:
// an artifact for another architecture extracts fine and then fails at exec.
export function platformKey(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return 'darwin-universal'
  if (platform === 'linux' && arch === 'x64') return 'linux-x86_64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-aarch64'
  if (platform === 'win32' && arch === 'x64') return 'windows-x86_64'
  if (platform === 'win32' && arch === 'arm64') return 'windows-aarch64'
  throw new JanInstallError(
    `the Jan runtime publishes no artifact for ${platform}/${arch}; it publishes ${PLATFORM_KEYS.join(', ')}`,
    { platform: `${platform}/${arch}` },
  )
}

// Where installed runtimes live: `JAN_AGENT_HOME` when set, otherwise the
// per-user cache directory each OS already has a convention for.
export function runtimeRoot(env = process.env) {
  if (env.JAN_AGENT_HOME) return env.JAN_AGENT_HOME
  const home = homedir()
  if (process.platform === 'win32') {
    return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'jan-agent', 'runtimes')
  }
  if (process.platform === 'darwin') return join(home, 'Library', 'Caches', 'jan-agent', 'runtimes')
  return join(env.XDG_CACHE_HOME ?? join(home, '.cache'), 'jan-agent', 'runtimes')
}

// The binary's name inside an installed runtime.
export function binName(platform = platformKey()) {
  return platform.startsWith('windows-') ? 'jan.exe' : 'jan'
}

function validVersion(version) {
  return typeof version === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9_+-])?$/.test(version)
}

function installDir(root, version, platform) {
  return join(root, version, platform)
}

// An installed runtime for `version`, read from the marker an install writes.
// No network: a caller who already has one pays nothing to find it, and a
// missing one answers `null` rather than throwing.
export async function findRuntime({ version, root = runtimeRoot() } = {}) {
  if (!validVersion(version)) return null
  root = resolve(root)
  const platform = platformKey()
  const dir = installDir(root, version, platform)
  let marker
  try {
    marker = JSON.parse(await readFile(join(dir, 'install.json'), 'utf8'))
  } catch {
    return null
  }
  if (!marker || marker.version !== version || marker.platform !== platform ||
      typeof marker.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(marker.sha256) ||
      typeof marker.directory !== 'string' ||
      !new RegExp(`^${platform}-[a-f0-9-]{36}$`).test(marker.directory)) return null
  const installedDir = join(root, version, marker.directory)
  const bin = join(installedDir, binName(platform))
  try {
    if (!(await lstat(bin)).isFile()) return null
  } catch {
    // A marker whose binary is gone is not an install: it is the remains of one.
    return null
  }
  return { ...marker, bin, dir: installedDir, root, cached: true }
}

// Install the runtime for this platform and return the path to its binary.
//
// `manifestUrl` names the channel (default: the one above). `version` and
// `sha256` pin: either is checked against the manifest and a mismatch is an
// error, never a silent fallback. `onProgress(received, total)` reports the
// download; `total` is 0 when the server sends no length.
export async function installRuntime(options = {}) {
  const {
    version,
    sha256,
    manifestUrl = process.env.JAN_AGENT_MANIFEST ?? MANIFEST_URL,
    root: requestedRoot = runtimeRoot(),
    fetch: fetchImpl = globalThis.fetch,
    signal,
    onProgress,
  } = options

  const root = resolve(requestedRoot)
  if (version !== undefined && !validVersion(version)) {
    throw new JanInstallError('version must be a single safe path component')
  }
  const platform = platformKey()
  if (version) {
    const hit = await findRuntime({ version, root })
    if (hit && (!sha256 || hit.sha256 === sha256)) return hit
  }

  const manifest = await readManifest(manifestUrl, fetchImpl, signal)
  if (version && manifest.version !== version) {
    throw new JanInstallError(
      `the manifest at ${manifestUrl} publishes ${manifest.version}, not ${version}: ` +
        'point `manifestUrl` at the manifest that names the version you are pinning, or drop it',
      { url: manifestUrl },
    )
  }
  const entry = manifest.platforms?.[platform]
  if (!entry?.url || !entry?.sha256) {
    throw new JanInstallError(
      `the manifest at ${manifestUrl} (version ${manifest.version}) has no entry for ${platform}`,
      { url: manifestUrl, platform },
    )
  }
  if (sha256 && sha256 !== entry.sha256) {
    throw new JanInstallError(
      `the manifest publishes ${entry.sha256} for ${platform}, not the ${sha256} this install pins`,
      { url: entry.url, expected: sha256, actual: entry.sha256, platform },
    )
  }

  const dir = installDir(root, manifest.version, platform)
  // An install of the version the manifest names, whose digest is still the one
  // the manifest publishes, is the artifact this call would fetch. A channel
  // that republished the same version with different bytes fails this check and
  // is downloaded again, which is the point of recording the digest.
  const existing = await findRuntime({ version: manifest.version, root })
  if (existing && existing.sha256 === entry.sha256) return existing

  await mkdir(dirname(dir), { recursive: true })
  const stage = await mkdtemp(join(dirname(dir), `.${platform}.part-`))
  const directory = `${platform}-${randomUUID()}`
  const installedDir = join(dirname(dir), directory)
  const markerTemp = join(dir, `.${randomUUID()}.json`)
  try {
    const archive = join(stage, basename(new URL(entry.url).pathname) || 'jan-runtime')
    const actual = await download(entry.url, archive, { fetchImpl, onProgress, signal })
    if (actual !== entry.sha256) {
      throw new JanInstallError(
        `the artifact downloaded from ${entry.url} hashes to ${actual}, not the ${entry.sha256} the manifest publishes`,
        { url: entry.url, expected: entry.sha256, actual, platform },
      )
    }
    await extract(archive, stage)
    await rm(archive, { force: true })

    const name = binName(platform)
    const bin = join(stage, name)
    try {
      if (!(await lstat(bin)).isFile()) throw new Error('not a regular file')
    } catch {
      throw new JanInstallError(
        `the ${platform} archive from ${entry.url} holds no ${name} at its root`,
        { url: entry.url, platform },
      )
    }
    if (process.platform !== 'win32') await chmod(bin, 0o755)

    const installedAt = new Date().toISOString()
    const marker = `${JSON.stringify({
      version: manifest.version,
      directory,
      pubDate: manifest.pub_date ?? null,
      platform,
      url: entry.url,
      sha256: actual,
      bin: name,
      installedAt,
    }, null, 2)}\n`

    // Never replace a published binary: another process may be using it, or
    // holding its path under a digest pin. Publish an immutable generation,
    // then atomically switch the small cache marker. Concurrent publishers
    // each retain a valid binary; the last marker wins for future lookups.
    await rename(stage, installedDir)
    await mkdir(dir, { recursive: true })
    await writeFile(markerTemp, marker, { flag: 'wx' })
    await rename(markerTemp, join(dir, 'install.json'))
    return {
      version: manifest.version,
      pubDate: manifest.pub_date ?? null,
      platform,
      url: entry.url,
      sha256: actual,
      installedAt,
      bin: join(installedDir, name),
      dir: installedDir,
      root,
      cached: false,
    }
  } catch (error) {
    await rm(markerTemp, { force: true })
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}

async function readManifest(url, fetchImpl, signal) {
  let response
  try {
    response = await fetchImpl(url, { signal, headers: { accept: 'application/json' } })
  } catch (error) {
    throw new JanInstallError(`could not read the runtime manifest at ${url}: ${error.message}`, { url })
  }
  if (!response.ok) {
    throw new JanInstallError(`the runtime manifest at ${url} answered ${response.status}`, { url })
  }
  let manifest
  try {
    manifest = await response.json()
  } catch (error) {
    throw new JanInstallError(`the runtime manifest at ${url} is not JSON: ${error.message}`, { url })
  }
  if (!validVersion(manifest?.version) || typeof manifest.platforms !== 'object' || manifest.platforms === null) {
    throw new JanInstallError(`the runtime manifest at ${url} names no version and no platforms`, { url })
  }
  return manifest
}

// Stream the artifact to `target`, hashing as it arrives, and answer the digest.
// Nothing is kept if the transfer fails: the caller stages inside a directory it
// removes on any error.
async function download(url, target, { fetchImpl, onProgress, signal }) {
  const response = await fetchImpl(url, { signal })
  if (!response.ok) {
    throw new JanInstallError(`the artifact at ${url} answered ${response.status}`, { url })
  }
  if (!response.body) {
    throw new JanInstallError(`the artifact at ${url} arrived with no body`, { url })
  }
  const total = Number(response.headers?.get?.('content-length') ?? 0)
  const hash = createHash('sha256')
  let received = 0
  async function* counted(source) {
    for await (const chunk of source) {
      hash.update(chunk)
      received += chunk.length
      onProgress?.(received, total)
      yield chunk
    }
  }
  await pipeline(Readable.fromWeb(response.body), counted, createWriteStream(target))
  return hash.digest('hex')
}

// The archives are a tarball on macOS and Linux and a zip on Windows. The
// system `tar` reads both (GNU tar on Linux, bsdtar on macOS and on the Windows
// that ships with it), which is one code path and no dependency.
//
// On Windows that means the one in System32, named by path: under Git Bash or
// MSYS the `tar` on PATH is GNU tar, which reads the `C:` of an absolute path as
// a remote host and cannot open a zip at all.
//
// Members are listed and checked before anything is extracted: an archive whose
// entries would land outside the staging directory is refused, not followed.
// Current `tar` implementations refuse those members themselves (GNU tar strips
// a leading `/` and warns, bsdtar errors on `..`), so this is the policy stated
// in one place rather than left to whichever `tar` is on PATH - a digest proves
// the artifact is the one published, which is a promise about the channel and
// not about the archive's layout.
const TAR = process.platform === 'win32'
  ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar'

async function extract(archive, into) {
  const listing = await run(TAR, ['-tf', archive], archive, 'read')
  for (const name of listing.split(/\r?\n/).filter((line) => line.length > 0)) {
    const resolved = resolve(into, name)
    if (resolved !== into && !resolved.startsWith(into + sep)) {
      throw new JanInstallError(
        `${basename(archive)} holds a member outside the install directory (${name}); refusing to extract it`,
        { url: archive },
      )
    }
  }
  await run(TAR, ['-xf', archive, '-C', into], archive, 'extract')
}

async function run(command, args, archive, action) {
  return await new Promise((resolve_, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > 1 << 20) {
        child.kill()
        reject(new JanInstallError(`archive listing exceeds 1 MiB: ${archive}`, { url: archive }))
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2048)
    })
    child.once('error', (error) => {
      reject(
        new JanInstallError(
          `could not ${action} ${basename(archive)}: ${error.message} (${TAR} is required to install a runtime)`,
          { url: archive },
        ),
      )
    })
    child.once('close', (code) => {
      if (code === 0) resolve_(stdout)
      else reject(new JanInstallError(`could not ${action} ${basename(archive)}: tar exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`, { url: archive }))
    })
  })
}
