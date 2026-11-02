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
    ['--test', 'scripts/unified-baseline-replay.test.mjs'],
    { cwd: repo, encoding: 'utf8', timeout: 60_000 }
  )
  expect(run.error, String(run.error)).toBeUndefined()
  expect(run.status, run.stdout + run.stderr).toBe(0)
}, 70_000)
