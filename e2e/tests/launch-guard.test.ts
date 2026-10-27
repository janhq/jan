import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assertSafeE2eHome, assertSafeLaunchEnvironment, canonicalPath, type LaunchContext } from '../launch-guard.js'
import { isolationEnv } from '../isolation.js'

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
