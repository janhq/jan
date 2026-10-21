#!/usr/bin/env node
/**
 * Installs a locally built Jan over the installed one.
 *
 * The desktop app is a Tauri bundle: the web app and the plugins are compiled
 * into the executable, so patching the installed app means replacing that
 * executable. The sidecars and the engine binaries next to it are left alone.
 *
 *   node scripts/patch-installed-jan.mjs \
 *     --build src-tauri/target/release/Jan-Desktop.exe \
 *     --install "$env:LOCALAPPDATA\Programs\Jan"
 *
 * The original executable is kept next to the new one as
 * `Jan-Desktop.exe.orig`, so the patch can be undone.
 */

import { copyFileSync, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

const buildPath = resolve(
  String(args.build || join('src-tauri', 'target', 'release', 'Jan-Desktop.exe'))
)
const installDir = resolve(
  String(
    args.install ||
      join(
        homedir(),
        'AppData',
        'Local',
        'Programs',
        'Jan'
      )
  )
)
const target = join(installDir, 'Jan-Desktop.exe')
const backup = join(installDir, 'Jan-Desktop.exe.orig')

if (!existsSync(buildPath)) {
  console.error(`the build output is missing: ${buildPath}`)
  process.exit(2)
}
if (!existsSync(target)) {
  console.error(`there is no installed app at: ${target}`)
  process.exit(2)
}

const size = (statSync(buildPath).size / (1024 * 1024)).toFixed(1)
console.log(`patching ${target}`)
console.log(`  from ${buildPath} (${size} MB)`)

// The executable is locked while the app runs, so the copy is retried for a
// while: the app may still be shutting down.
async function copyWithRetry(from, to, attempts = 20) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      copyFileSync(from, to)
      return
    } catch (error) {
      if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error
      if (attempt === attempts) {
        throw new Error(
          `${to} is still locked. Close the running app and try again.`
        )
      }
      await sleep(500)
    }
  }
}

if (!existsSync(backup)) {
  await copyWithRetry(target, backup)
  console.log(`  backed the original up to ${backup}`)
} else {
  console.log(`  keeping the existing backup at ${backup}`)
}

await copyWithRetry(buildPath, target)
console.log('done: the installed app now runs the patched build')
console.log('undo with: copy the .orig file back over Jan-Desktop.exe')
