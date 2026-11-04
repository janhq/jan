/**
 * Runs the replay CLI's own `node --test` suite (fake loopback servers only)
 * so it executes wherever `yarn test` runs, including CI. No real model.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

it('unified-baseline replay CLI suite passes', () => {
  const run = spawnSync(
    process.execPath,
    // Run directly (no --test sub-process), so the SIGTERM sent on timeout
    // reaches the suite, which then kills only the CLI children it recorded.
    // Child deadlines (6 s each, 4 sequential CLI runs) stay well inside this.
    ['scripts/unified-baseline-replay.test.mjs'],
    { cwd: repo, encoding: 'utf8', timeout: 90_000, killSignal: 'SIGTERM' }
  )
  expect(run.error, String(run.error)).toBeUndefined()
  expect(run.status, run.stdout + run.stderr).toBe(0)
}, 100_000)
