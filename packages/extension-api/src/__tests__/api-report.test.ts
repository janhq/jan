/// <reference types="node" />
// Keeps the committed api-report.d.ts equal to the declarations the build
// emits, so every change to the public API is a reviewed diff of that file.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('api-report.d.ts', () => {
  it('matches the declarations the package build emits', () => {
    const fresh = execFileSync(
      process.execPath,
      [join(ROOT, 'scripts', 'api-report.mjs'), '--stdout'],
      { cwd: ROOT, encoding: 'utf8' }
    )
    const committed = readFileSync(join(ROOT, 'api-report.d.ts'), 'utf8')
    expect(
      committed,
      'The public API of @janhq/extension-api changed. Review the change, then ' +
        'run `yarn workspace @janhq/extension-api api-report` and commit ' +
        'api-report.d.ts.'
    ).toBe(fresh)
  }, 60_000)
})
