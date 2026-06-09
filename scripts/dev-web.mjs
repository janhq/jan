#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { closeSync, openSync, unlinkSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 1420
const HOST = '127.0.0.1'
const LOCK_PATH = join(tmpdir(), 'jan-vite-dev.lock')

function isPortInUse(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    socket.once('connect', () => {
      socket.end()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function releaseLock() {
  try {
    unlinkSync(LOCK_PATH)
  } catch {
    // ignore
  }
}

function acquireLock() {
  try {
    const fd = openSync(LOCK_PATH, 'wx')
    closeSync(fd)
    return true
  } catch {
    return false
  }
}

async function waitForExistingVite() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isPortInUse(PORT, HOST)) {
      console.log(
        `[dev-web] Port ${PORT} is already in use — reusing existing Vite dev server.`
      )
      process.exit(0)
    }
    await sleep(200)
  }

  console.error('[dev-web] Timed out waiting for Vite dev server on port 1420.')
  process.exit(1)
}

if (await isPortInUse(PORT, HOST)) {
  console.log(
    `[dev-web] Port ${PORT} is already in use — reusing existing Vite dev server.`
  )
  process.exit(0)
}

if (!acquireLock()) {
  await waitForExistingVite()
}

const child = spawn('yarn', ['workspace', '@janhq/web-app', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    IS_TAURI: process.env.IS_TAURI ?? 'true',
    IS_DEV: process.env.IS_DEV ?? 'true',
  },
})

const cleanup = () => {
  releaseLock()
}

child.on('exit', (code, signal) => {
  cleanup()
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

process.on('SIGINT', () => {
  cleanup()
  child.kill('SIGINT')
})

process.on('SIGTERM', () => {
  cleanup()
  child.kill('SIGTERM')
})