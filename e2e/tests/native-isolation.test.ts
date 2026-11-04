import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkFreshNativeRoot } from '../check-native-isolation.js'

test('manual native preflight requires absolute canonical fresh empty root', () => {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'jan-native-guard-'))
  const root = join(base, 'profile')
  const realHome = join(base, 'decoy-home')
  mkdirSync(root)
  mkdirSync(realHome)
  const context = { env: {}, platform: process.platform, realHomes: [realHome], tempRoot: base }
  try {
    assert.equal(checkFreshNativeRoot(root, context), root)
    assert.throws(() => checkFreshNativeRoot('relative', context), /absolute/)
    assert.throws(() => checkFreshNativeRoot(base, context), /strictly inside/)
    assert.throws(() => checkFreshNativeRoot(realHome, context), /real home/)
    assert.throws(() => checkFreshNativeRoot(join(base, 'missing'), context), /ENOENT/)
    writeFileSync(join(root, 'sentinel'), 'not fresh')
    assert.throws(() => checkFreshNativeRoot(root, context), /fresh empty/)
    assert.throws(() => checkFreshNativeRoot(root, { ...context, env: { JAN_DATA_ROOT: '/external' }, platform: 'darwin' }), /Unset JAN_DATA_ROOT/)
    if (process.platform !== 'win32') {
      const alias = join(base, 'alias')
      symlinkSync(root, alias)
      assert.throws(() => checkFreshNativeRoot(alias, context), /canonical/)
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
