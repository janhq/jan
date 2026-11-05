// Read-only preflight for a fresh manual native QA profile. Never launches Jan.
import { readdirSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertSafeE2eHome, launchContext, type LaunchContext } from './launch-guard.js'

export function checkFreshNativeRoot(root: string, context: LaunchContext): string {
  if (!isAbsolute(root)) throw new Error('Native QA root must be absolute')
  const safe = assertSafeE2eHome(root, context)
  if (safe !== root) throw new Error('Native QA root must be canonical, with no symlink aliases')
  if (readdirSync(safe).length !== 0) throw new Error('Native QA root must be an existing fresh empty directory')
  return safe
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2]
  if (!root) throw new Error('Usage: yarn check:native-isolation /absolute/fresh/temp/root')
  console.log(`Fresh native QA root validated: ${checkFreshNativeRoot(root, launchContext())}`)
  console.log('Build with --features e2e. WebKit storage is ephemeral, not rooted on disk. This is not a filesystem sandbox.')
}
