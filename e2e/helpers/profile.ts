import { browser } from '@wdio/globals'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getJanDataFolder } from './profileState'

/**
 * Fixture writers for per-run profiles. Specs that depend on existing
 * threads / assistants / etc. seed them onto disk and then call
 * `reloadAfterSeed()` so the renderer re-fetches from the Rust backend.
 *
 * Layout mirrors the constants in src-tauri/src/core/threads/constants.rs
 * and the assistant-extension:
 *   <data>/threads/<id>/thread.json
 *   <data>/threads/<id>/messages.jsonl
 *   <data>/assistants/<id>/assistant.json
 */

export type SeedThread = {
  id?: string
  title: string
  /** epoch seconds; default = now */
  updated?: number
  metadata?: Record<string, unknown>
}

export type SeedAssistant = {
  id?: string
  name: string
  description?: string
  instructions?: string
  avatar?: string
  /** epoch seconds; default = now */
  created_at?: number
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Seed one thread into the active profile. Returns the thread id (the
 * caller's id, or a freshly generated UUID).
 */
export function seedThread(thread: SeedThread): string {
  const id = thread.id ?? randomUUID()
  const dataFolder = getJanDataFolder()
  const dir = join(dataFolder, 'threads', id)
  mkdirSync(dir, { recursive: true })

  const payload = {
    id,
    title: thread.title,
    updated: thread.updated ?? nowSeconds(),
    metadata: thread.metadata ?? {},
  }
  writeFileSync(join(dir, 'thread.json'), JSON.stringify(payload, null, 2))
  // Empty messages file so list_messages returns a non-error response.
  writeFileSync(join(dir, 'messages.jsonl'), '')
  return id
}

/** Seed one assistant. Default Jan is created by the app on first run. */
export function seedAssistant(assistant: SeedAssistant): string {
  const id = assistant.id ?? randomUUID()
  const dataFolder = getJanDataFolder()
  const dir = join(dataFolder, 'assistants', id)
  mkdirSync(dir, { recursive: true })

  const payload = {
    id,
    name: assistant.name,
    description: assistant.description ?? '',
    instructions: assistant.instructions ?? '',
    avatar: assistant.avatar ?? '',
    created_at: assistant.created_at ?? nowSeconds(),
    parameters: {},
  }
  writeFileSync(
    join(dir, 'assistant.json'),
    JSON.stringify(payload, null, 2)
  )
  return id
}

/**
 * Reload the renderer after writing fixtures so the React stores re-hydrate
 * from the Rust backend. Cheaper than restarting the Tauri shell.
 */
export async function reloadAfterSeed(): Promise<void> {
  await browser.refresh()
}
