import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assertSafeE2eHome, assertSafeLaunchEnvironment, canonicalPath, launchContext, type LaunchContext } from '../launch-guard.js'
import { isolationEnv } from '../isolation.js'

test('account lookup failure reports the isolation requirement and preserves its cause', () => {
  const cause = new Error('no passwd entry')
  assert.throws(() => launchContext(() => { throw cause }), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /Cannot validate e2e isolation.*account home/)
    assert.equal(error.cause, cause)
    return true
  })
})

function fixture(t: { after: (fn: () => void) => void }) {
  const root = canonicalPath(mkdtempSync(join(tmpdir(), 'jan-guard-test-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const realHome = join(root, 'user')
  mkdirSync(realHome)
  const context: LaunchContext = { env: {}, platform: process.platform, realHomes: [realHome], tempRoot: root }
  return { root, realHome, context }
}

test('rejects real home and Jan ancestors/descendants without writes', (t) => {
  const { root, realHome, context } = fixture(t)
  const jan = join(realHome, '.local/share/Jan')
  mkdirSync(jan, { recursive: true })
  const sentinel = join(jan, 'settings.json')
  writeFileSync(sentinel, 'untouched')
  const before = readdirSync(root, { recursive: true })
  for (const home of [realHome, root, join(realHome, '.local'), jan, join(jan, 'new/profile'), join(realHome, '.jan/new')]) {
    assert.throws(() => assertSafeE2eHome(home, context), /Unsafe/)
  }
  assert.deepEqual(readdirSync(root, { recursive: true }), before)
  assert.equal(readFileSync(sentinel, 'utf8'), 'untouched')
})

test('accepts CI temp profile, mkdtemp, and prefix siblings, without creating targets', (t) => {
  const { root, realHome, context } = fixture(t)
  for (const home of [join(root, 'jan-e2e-home'), join(realHome, '.local/share/Jan-other')]) {
    const before = readdirSync(root, { recursive: true })
    assert.equal(assertSafeE2eHome(home, context), canonicalPath(home))
    assert.deepEqual(readdirSync(root, { recursive: true }), before)
  }
  const generated = mkdtempSync(join(root, 'jan-e2e-'))
  assert.equal(assertSafeE2eHome(generated, context), generated)
  assert.throws(() => assertSafeE2eHome(join(root, '..', 'outside'), context), /temp root/)
})

test('protects inherited custom XDG and Windows app-data locations', (t) => {
  const { root, context } = fixture(t)
  for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'APPDATA', 'LOCALAPPDATA']) {
    const base = join(root, `custom-${key}`)
    const overridden = { ...context, env: { [key]: base } }
    assert.throws(() => assertSafeE2eHome(join(base, 'Jan/new'), overridden), /overlaps/)
    assert.throws(() => assertSafeE2eHome(base, overridden), /overlaps/)
    assertSafeE2eHome(`${base}-sibling`, overridden)
  }
})

test('environment bypasses fail before any profile creation', (t) => {
  const { root, context } = fixture(t)
  const before = readdirSync(root, { recursive: true })
  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    for (const env of [{ CI: 'e2e' }, { JAN_DATA_FOLDER: join(root, 'outside') }, { APP_NAME: '../elsewhere' }, { APP_NAME: '' }]) {
      assert.throws(() => assertSafeLaunchEnvironment({ ...context, platform, env }))
    }
    for (const value of ['', undefined]) {
      assertSafeLaunchEnvironment({ ...context, platform, env: { JAN_DATA_ROOT: value, CI: 'true' } })
    }
  }
  for (const platform of ['linux', 'darwin'] as const) {
    for (const value of ['relative', ' ', join(root, 'override')]) {
      assert.throws(() => assertSafeE2eHome(join(root, 'new'), { ...context, platform, env: { JAN_DATA_ROOT: value } }), /JAN_DATA_ROOT/)
    }
  }
  assertSafeLaunchEnvironment({ ...context, platform: 'win32', env: { JAN_DATA_ROOT: 'inherited-is-overridden' } })
  assert.deepEqual(readdirSync(root, { recursive: true }), before)
})

test('canonicalizes symlink prefixes and rejects redirected seed paths', (t) => {
  const { root, realHome, context } = fixture(t)
  const alias = join(root, 'alias')
  try {
    symlinkSync(realHome, alias, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code!)) {
      t.skip('Windows symlink privilege unavailable')
      return
    }
    throw error
  }
  assert.throws(() => assertSafeE2eHome(alias, context), /Unsafe/)
  assert.throws(() => assertSafeE2eHome(join(alias, '.jan/not-created'), context), /Unsafe/)
  const profile = join(root, 'profile')
  mkdirSync(profile)
  symlinkSync(realHome, join(profile, '.local'), process.platform === 'win32' ? 'junction' : 'dir')
  const before = readdirSync(root, { recursive: true })
  assert.throws(() => assertSafeE2eHome(profile, context), /escapes/)
  assert.deepEqual(readdirSync(root, { recursive: true }), before)
})

test('rejects existing desktop data_folder escape before changing settings', (t) => {
  const { root, realHome, context } = fixture(t)
  const profile = join(root, 'profile')
  const dir = join(profile, '.local/share/Jan')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'settings.json')
  const unsafe = JSON.stringify({ data_folder: realHome })
  writeFileSync(file, unsafe)
  assert.throws(() => assertSafeE2eHome(profile, { ...context, platform: 'linux' }), /data_folder/)
  assert.equal(readFileSync(file, 'utf8'), unsafe)
  writeFileSync(file, JSON.stringify({ data_folder: join(profile, 'data') }))
  assertSafeE2eHome(profile, { ...context, platform: 'linux' })
})

// Platform resolution is simulated, but all filesystem paths are native paths
// under the fixture's temp root -- never a developer's real Jan directories.
const migrationCases = (['linux', 'darwin', 'win32'] as const).flatMap(platform => {
  const dataRoot = platform === 'win32' ? 'AppData/Roaming'
    : platform === 'darwin' ? 'Library/Application Support' : '.local/share'
  return [
    ...['jan.ai.app', 'jan-nightly.ai.app', 'jan-beta.ai.app'].map(id => join(dataRoot, id, 'settings.json')),
    ...(platform === 'linux' ? [join('.config/Jan/settings.json')] : []),
  ].map(suffix => ({ platform, suffix, dataRoot }))
})

for (const { platform, suffix, dataRoot } of migrationCases) {
  test(`validates migration data_folder read-only: ${platform}/${suffix}`, (t) => {
    const { root, realHome, context } = fixture(t)
    const profile = join(root, 'profile')
    const file = join(profile, suffix)
    mkdirSync(join(file, '..'), { recursive: true })
    const launch = () => assertSafeE2eHome(profile, { ...context, platform })
    for (const value of [realHome, 'relative', '', null, 123]) {
      const unsafe = JSON.stringify({ data_folder: value })
      writeFileSync(file, unsafe)
      const before = readdirSync(root, { recursive: true })
      assert.throws(launch, /data_folder/)
      assert.deepEqual(readdirSync(root, { recursive: true }), before)
      assert.equal(readFileSync(file, 'utf8'), unsafe)
    }
    // Deliberately conservative: canonical config shadows this source in Rust,
    // but must not hide unsafe legacy settings from the launch guard.
    const canonicalDir = join(profile, dataRoot, 'Jan')
    mkdirSync(canonicalDir, { recursive: true })
    writeFileSync(join(canonicalDir, 'settings.json'), '{}')
    assert.throws(launch, /data_folder/)
    for (const config of [{}, { data_folder: join(profile, 'data') }]) {
      writeFileSync(file, JSON.stringify(config))
      assert.equal(launch(), profile)
    }
  })

  for (const kind of ['directory', 'file', 'dangling file', 'data_folder'] as const) {
    test(`rejects migration ${kind} symlink: ${platform}/${suffix}`, (t) => {
      const { root, realHome, context } = fixture(t)
      const profile = join(root, 'profile')
      const file = join(profile, suffix)
      const outside = join(realHome, 'settings.json')
      writeFileSync(outside, '{}')
      mkdirSync(join(file, '..'), { recursive: true })
      const link = kind === 'directory' ? join(file, '..')
        : kind === 'data_folder' ? join(profile, 'data') : file
      if (kind === 'directory') rmSync(link, { recursive: true })
      const target = kind === 'directory' || kind === 'data_folder' ? realHome
        : kind === 'dangling file' ? join(realHome, 'missing.json') : outside
      try {
        symlinkSync(target, link, kind === 'directory' || kind === 'data_folder'
          ? process.platform === 'win32' ? 'junction' : 'dir' : 'file')
      } catch (error) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code!)) {
          t.skip('Windows symlink privilege unavailable')
          return
        }
        throw error
      }
      if (kind === 'data_folder') writeFileSync(file, JSON.stringify({ data_folder: link }))
      const before = readdirSync(root, { recursive: true })
      assert.throws(() => assertSafeE2eHome(profile, { ...context, platform }), /Unsafe/)
      assert.deepEqual(readdirSync(root, { recursive: true }), before)
      assert.equal(readFileSync(outside, 'utf8'), '{}')
    })
  }
}

test('isolation env overrides inherited path variables; Unix retains native resolution', (t) => {
  const { root } = fixture(t)
  const home = join(root, 'profile')
  const overrides = isolationEnv(home)
  const merged = { HOME: 'real-home', TMPDIR: 'real-temp', XDG_CONFIG_HOME: 'real-config', JAN_DATA_ROOT: '', ...overrides }
  assert.equal(merged.HOME, home)
  if (process.platform === 'win32') {
    assert.equal(merged.JAN_DATA_ROOT, join(home, 'AppData/Roaming'))
  } else {
    assert.equal(merged.JAN_DATA_ROOT, '')
    assert.equal(merged.TMPDIR, join(home, 'tmp'))
    if (process.platform === 'linux') assert.equal(merged.XDG_CONFIG_HOME, join(home, '.config'))
  }
})
