import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Built-in extensions reach the host only through `@janhq/core` and each
// plugin's typed guest-js wrapper. A raw `invoke('plugin:<name>|...')` skips
// the wrapper, so its argument shape is unchecked -- which is how llamacpp's
// getDevices shipped sending a `libraryPath` the command does not take.
const REPO_ROOT = join(__dirname, '..')
const EXTENSIONS_DIR = join(REPO_ROOT, 'extensions')
const WEB_APP_SRC = join(REPO_ROOT, 'web-app', 'src')
const PLUGINS_DIR = join(REPO_ROOT, 'src-tauri', 'plugins')
const PLUGIN_CRATE_PREFIX = 'tauri-plugin-'
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', '__tests__'])
const TEST_FILE = /\.(test|spec)\.tsx?$/
// Any `@tauri-apps/*` package, not just api/core: events, plugin-http and the
// rest are host facilities a built-in reaches through `ctx.internal`.
const TAURI_IMPORT = /['"]@tauri-apps\//

interface Plugin {
  name: string
  guestJs: string
}

// Tauri addresses a plugin by the name its crate passes to Builder::new, which
// by convention is the crate name minus `tauri-plugin-`.
function discoverPlugins(): Plugin[] {
  return readdirSync(PLUGINS_DIR)
    .map((dir) => join(PLUGINS_DIR, dir))
    .filter((dir) => existsSync(join(dir, 'guest-js')))
    .map((dir) => {
      const cargo = readFileSync(join(dir, 'Cargo.toml'), 'utf8')
      const crate = /^name\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] ?? ''
      return {
        name: crate.startsWith(PLUGIN_CRATE_PREFIX)
          ? crate.slice(PLUGIN_CRATE_PREFIX.length)
          : crate,
        guestJs: join(dir, 'guest-js'),
      }
    })
}

function collectSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      return SKIP_DIRS.has(entry) ? [] : collectSources(full)
    }
    return /\.tsx?$/.test(entry) && !TEST_FILE.test(entry) ? [full] : []
  })
}

function extensionSources(): string[] {
  return readdirSync(EXTENSIONS_DIR)
    .map((entry) => join(EXTENSIONS_DIR, entry, 'src'))
    .filter((src) => existsSync(src))
    .flatMap(collectSources)
}

function offendingLines(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        pattern.test(line)
          ? [`${relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`]
          : []
      )
  )
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const plugins = discoverPlugins()
const rawInvoke = new RegExp(
  `plugin:(${plugins.map(({ name }) => escapeRegExp(name)).join('|')})\\|`
)

describe('built-in extensions do not invoke Tauri directly', () => {
  it('derives each plugin name the way its guest-js addresses it', () => {
    expect(plugins.length).toBeGreaterThan(0)
    const mismatched = plugins.filter(
      ({ name, guestJs }) =>
        !collectSources(guestJs).some((file) =>
          readFileSync(file, 'utf8').includes(`plugin:${name}|`)
        )
    )
    expect(mismatched, JSON.stringify(mismatched)).toEqual([])
  })

  it('has no @tauri-apps/* import under extensions/*/src', () => {
    const offenders = offendingLines(extensionSources(), TAURI_IMPORT)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  // A bundler `inject` is an import by another name: it rewrites every bare
  // `fetch` in the bundle to a Tauri plugin the source never mentions.
  it('has no @tauri-apps/* module injected by an extension bundle config', () => {
    const configs = readdirSync(EXTENSIONS_DIR)
      .map((entry) => join(EXTENSIONS_DIR, entry, 'rolldown.config.mjs'))
      .filter((config) => existsSync(config))
    expect(configs.length).toBeGreaterThan(0)
    const offenders = offendingLines(configs, TAURI_IMPORT)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('has no raw plugin:<name>| command under extensions/*/src', () => {
    const offenders = offendingLines(extensionSources(), rawInvoke)
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

// The app is held to the same rule: a command string outside a plugin's
// guest-js is a second, untyped copy of that plugin's API.
describe('the web app does not address plugins directly', () => {
  it('has no raw plugin:<name>| command under web-app/src', () => {
    const offenders = offendingLines(collectSources(WEB_APP_SRC), rawInvoke)
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
