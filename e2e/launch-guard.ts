import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface LaunchContext {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  // Explicit homes make unit tests independent of the developer's filesystem.
  realHomes: string[]
  tempRoot: string
}

export function launchContext(accountHome: () => string = () => userInfo().homedir): LaunchContext {
  let realAccountHome: string
  try {
    realAccountHome = accountHome()
  } catch (error) {
    // Fail closed: HOME alone may have been redirected and is not evidence of
    // the account's real home (e.g. an arbitrary container UID without passwd).
    throw new Error('Cannot validate e2e isolation: unable to resolve the account home via os.userInfo()', { cause: error })
  }
  return {
    env: process.env,
    platform: process.platform,
    // HOME may itself have been overridden; protect the account home as well.
    realHomes: [realAccountHome, homedir()],
    tempRoot: tmpdir(),
  }
}

/** Read-only: resolve symlinks in the longest existing prefix, even for a new target. */
export function canonicalPath(target: string): string {
  let prefix = resolve(target)
  const tail: string[] = []
  for (;;) {
    try {
      return join(realpathSync(prefix), ...tail)
    } catch (error) {
      // Broken links and permission failures must not silently become safe paths.
      // realpath reports ENOENT for dangling links too; lstat below distinguishes them.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (isSymlink(prefix)) throw new Error(`Unsafe dangling symlink: ${prefix}`)
      const parent = dirname(prefix)
      if (parent === prefix) throw error
      tail.unshift(basename(prefix))
      prefix = parent
    }
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

/** Includes equality. Unlike a string prefix, /profile-other is not in /profile. */
export function containsPath(parent: string, child: string): boolean {
  const delta = relative(parent, child)
  return delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${sep}`))
}

/** Must run even before mkdtemp: these overrides bypass the native desktop lookup. */
export function assertSafeLaunchEnvironment({ env, platform }: LaunchContext): void {
  if (env.APP_NAME !== undefined && env.APP_NAME !== 'Jan') {
    throw new Error('Unset APP_NAME (or use Jan) for e2e: it redirects Jan paths')
  }
  if (env.CI === 'e2e') {
    throw new Error('Unsafe CI=e2e: bypasses native Jan configuration with ./data')
  }
  if (env.JAN_DATA_FOLDER) {
    throw new Error('Unset JAN_DATA_FOLDER for e2e: it bypasses the test profile')
  }
  if (platform !== 'win32' && env.JAN_DATA_ROOT) {
    throw new Error('Unset JAN_DATA_ROOT for e2e on Unix: it overrides native HOME/XDG resolution')
  }
}

/** No writes, environment mutations, or cleanup listeners. Call before all seeding. */
export function assertSafeE2eHome(home: string, context: LaunchContext): string {
  assertSafeLaunchEnvironment(context)
  const { env, realHomes } = context
  const candidate = canonicalPath(home)
  const tempRoot = canonicalPath(context.tempRoot)
  if (candidate === tempRoot || !containsPath(tempRoot, candidate)) {
    throw new Error(`Unsafe JAN_E2E_HOME ${home}: must be strictly inside temp root ${tempRoot}`)
  }
  const protectedPaths: string[] = []
  const bundleIds = ['jan.ai.app', 'jan-nightly.ai.app', 'jan-beta.ai.app']
  const addRoot = (root: string) => {
    for (const name of ['Jan', ...bundleIds]) protectedPaths.push(join(root, name))
  }
  for (const realHome of realHomes) {
    const canonicalHome = canonicalPath(realHome)
    if (candidate === canonicalHome) throw new Error(`Unsafe JAN_E2E_HOME: real home ${home}`)
    protectedPaths.push(join(realHome, '.jan'))
    for (const root of [
      '.local/share', '.local/state', '.config', '.cache',
      'Library/Application Support', 'Library/Caches', 'Library/Logs',
      'AppData/Roaming', 'AppData/Local',
    ]) addRoot(join(realHome, root))
  }
  for (const key of [
    'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME',
    'APPDATA', 'LOCALAPPDATA', 'JAN_DATA_ROOT',
  ]) {
    if (env[key] && isAbsolute(env[key]!)) addRoot(env[key]!)
  }
  for (const path of protectedPaths) {
    const protectedPath = canonicalPath(path)
    if (containsPath(candidate, protectedPath) || containsPath(protectedPath, candidate)) {
      throw new Error(`Unsafe JAN_E2E_HOME ${home}: overlaps real Jan path ${path}`)
    }
  }

  // Existing subdirectories (or the settings file itself) may be symlinks too.
  // Check all redirected roots and seed destinations before mkdir/writeFile.
  for (const suffix of [
    'tmp', '.jan', '.local/share', '.local/state', '.config', '.cache',
    'Library/Application Support', 'Library/Caches', 'Library/Logs',
    'AppData/Roaming', 'AppData/Local',
    '.local/share/Jan/data/settings.json',
    'Library/Application Support/Jan/data/settings.json',
    'AppData/Roaming/Jan/data/settings.json',
  ]) {
    if (!containsPath(candidate, canonicalPath(join(candidate, suffix)))) {
      throw new Error(`Unsafe JAN_E2E_HOME ${home}: ${suffix} escapes profile`)
    }
  }
  const dataRoot = context.platform === 'win32'
    ? 'AppData/Roaming/Jan'
    : context.platform === 'darwin' ? 'Library/Application Support/Jan' : '.local/share/Jan'
  // Rust commands.rs checks canonical Jan/settings.json first; only if absent
  // does it migrate the first file from bundle-id settings, then (Linux only)
  // .config/Jan/settings.json. Migration copies AND removes its source. Validate
  // every candidate, even those shadowed by an existing/higher-priority file,
  // rather than depending on files remaining unchanged until the app starts.
  // The Rust constant is currently jan.ai.app; include known channel IDs too
  // conservatively, although a build may never consult those candidates.
  const configFiles = [
    join(candidate, dataRoot, 'settings.json'),
    ...bundleIds.map(id => join(candidate, dirname(dataRoot), id, 'settings.json')),
    ...(context.platform === 'linux' ? [join(candidate, '.config/Jan/settings.json')] : []),
  ]
  for (const configFile of configFiles) {
    if (!containsPath(candidate, canonicalPath(configFile))) {
      throw new Error(`Unsafe settings path: ${configFile}`)
    }
    try {
      const config = JSON.parse(readFileSync(configFile, 'utf8'))
      if (config.data_folder !== undefined && (
        typeof config.data_folder !== 'string' || !isAbsolute(config.data_folder) ||
        !containsPath(candidate, canonicalPath(config.data_folder))
      )) throw new Error(`Unsafe data_folder in ${configFile}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return candidate
}
