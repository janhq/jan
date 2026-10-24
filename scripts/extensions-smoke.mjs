// End-to-end smoke install of the sample extension (`make
// test-extensions-smoke`): build @janhq/sample-hello-provider, `yarn pack`
// it into a temporary directory, install the tarball with the extensions
// plugin's Rust install pipeline (tests/smoke.rs) into a fresh extensions
// root, then load that root in the web-app's extension host
// (smoke.installed.test.ts). The two halves share JAN_EXT_SMOKE_ROOT.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const SAMPLE = '@janhq/sample-hello-provider'

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    // yarn is a .cmd shim on Windows.
    shell: process.platform === 'win32',
    ...options,
    env: { ...process.env, ...options.env },
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
}

const work = mkdtempSync(join(tmpdir(), 'jan-ext-smoke-'))
const root = join(work, 'extensions')
let failed = false
try {
  // The sample's build needs the API package; the vitest half needs the
  // runtime package's prelude.
  run('yarn', ['build:extension-api'])
  run('yarn', ['build:extension-runtime'])
  run('yarn', ['workspace', SAMPLE, 'build'])
  run('yarn', ['workspace', SAMPLE, 'pack', '--out', join(work, '%s-%v.tgz')])
  const tgz = readdirSync(work).find((f) => f.endsWith('.tgz'))
  if (!tgz) throw new Error(`yarn pack wrote no .tgz into ${work}`)

  const env = {
    JAN_EXT_SMOKE_TGZ: join(work, tgz),
    JAN_EXT_SMOKE_ROOT: root,
  }
  run(
    'cargo',
    [
      'test',
      '--locked',
      '--manifest-path',
      'src-tauri/plugins/tauri-plugin-extensions/Cargo.toml',
      '--test',
      'smoke',
      '--',
      '--ignored',
    ],
    { env }
  )
  run(
    'yarn',
    [
      'vitest',
      'run',
      '--project',
      '@janhq/web-app',
      'src/lib/extensions/__tests__/smoke.installed.test.ts',
    ],
    { env }
  )
  console.log('\nExtensions smoke test passed.')
} catch (error) {
  failed = true
  console.error(`\nExtensions smoke test failed: ${error.message}`)
  console.error(`Kept ${work} for inspection.`)
} finally {
  if (!failed) rmSync(work, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
