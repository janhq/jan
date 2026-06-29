import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSafeArchivePath } from './archive-extract-guard.mjs'

test('rejects unsafe archive entry paths', () => {
  assert.throws(() => assertSafeArchivePath('../escape.txt', 'scripts/dist', '.zip'), /Unsafe \.zip entry path/)
  assert.throws(() => assertSafeArchivePath('nested/../../escape.txt', 'scripts/dist', '.tar.gz'), /Unsafe \.tar\.gz entry path/)
  assert.throws(() => assertSafeArchivePath('/etc/passwd', 'scripts/dist', '.zip'), /Unsafe \.zip entry path/)
  assert.throws(
    () => assertSafeArchivePath('C:/Windows/System32/drivers/etc/hosts', 'scripts/dist', '.zip'),
    /Unsafe \.zip entry path/
  )
  assert.throws(() => assertSafeArchivePath('..\\escape.txt', 'scripts/dist', '.zip'), /Unsafe \.zip entry path/)
  assert.doesNotThrow(() => assertSafeArchivePath('nested/file.txt', 'scripts/dist', '.zip'))
})
