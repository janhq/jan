import { vi } from 'vitest'
import type { PermissionString } from '@janhq/extension-api'
import { manifest } from '@/lib/extensions/__tests__/fixtures'
import type {
  CuratedIndex,
  ExtensionsService,
  IndexSource,
  InstalledExtension,
  StagedInstall,
} from '../types'

/** An installed entry; fields can be overridden per test. */
export function installed(
  id: string,
  extra: Partial<InstalledExtension> = {}
): InstalledExtension {
  return {
    id,
    manifest: manifest(id, { displayName: `Ext ${id}` }),
    enabled: true,
    active: '1.0.0',
    source: { kind: 'bundle', fileName: `${id}.tgz`, sha512: 'sha512-abc' },
    verified: false,
    granted: [],
    entrySha512: 'sha512-entry',
    installedAt: '2026-10-23T10:00:00Z',
    ...extra,
  }
}

/** A staged install of `id` requesting `permissions`. */
export function staged(
  id: string,
  permissions: PermissionString[],
  extra: Partial<StagedInstall> = {}
): StagedInstall {
  return {
    stageId: `stage-${id}`,
    manifest: manifest(id, { displayName: `Ext ${id}`, permissions }),
    sha512: 'sha512-c3RhZ2Vk',
    verified: false,
    permissionDiff: { added: permissions, removed: [] },
    ...extra,
  }
}

export interface MockState {
  safeMode: boolean
  extensions: InstalledExtension[]
  sources: IndexSource[]
  catalogs: Record<string, CuratedIndex>
  /** What the next stage call returns. */
  stage?: StagedInstall
}

/**
 * An in-memory `ExtensionsService` whose methods are spies, so a test can
 * assert both the calls and what the page shows after them.
 */
export function createMockExtensionsService(initial: Partial<MockState> = {}) {
  const state: MockState = {
    safeMode: false,
    extensions: [],
    sources: [],
    catalogs: {},
    ...initial,
  }
  const find = (id: string) => {
    const entry = state.extensions.find((e) => e.id === id)
    if (!entry) throw new Error(`not installed: ${id}`)
    return entry
  }
  const takeStage = async () => {
    if (!state.stage) throw new Error('nothing to stage')
    return state.stage
  }
  const service = {
    isSupported: vi.fn(() => true),
    stageBundle: vi.fn(async (_path: string) => takeStage()),
    stageFromIndex: vi.fn(
      async (_sourceId: string, _id: string, _version: string) => takeStage()
    ),
    confirmInstall: vi.fn(
      async (stageId: string, granted: PermissionString[]) => {
        const stage = state.stage
        if (!stage || stage.stageId !== stageId) throw new Error('no stage')
        const entry = installed(stage.manifest.id, {
          manifest: stage.manifest,
          active: stage.manifest.version,
          granted,
          verified: stage.verified,
        })
        state.extensions = [
          ...state.extensions.filter((e) => e.id !== entry.id),
          entry,
        ]
        state.stage = undefined
        return entry
      }
    ),
    discardStage: vi.fn(async (_stageId: string) => {
      state.stage = undefined
    }),
    list: vi.fn(async () => ({
      safeMode: state.safeMode,
      extensions: state.extensions.map((e) => ({ ...e })),
    })),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      find(id).enabled = enabled
    }),
    setGrants: vi.fn(async (id: string, granted: PermissionString[]) => {
      find(id).granted = granted
    }),
    uninstall: vi.fn(async (id: string) => {
      state.extensions = state.extensions.filter((e) => e.id !== id)
    }),
    rollback: vi.fn(async (id: string) => {
      const entry = find(id)
      if (!entry.previous) throw new Error('no previous version')
      ;[entry.active, entry.previous] = [entry.previous, entry.active]
      return { ...entry }
    }),
    setSafeMode: vi.fn(async (on: boolean) => {
      state.safeMode = on
    }),
    listSources: vi.fn(async () => [...state.sources]),
    addSource: vi.fn(async (url: string, name: string, publicKey?: string) => {
      const source: IndexSource = {
        id: `source-${state.sources.length + 1}`,
        name,
        url,
        ...(publicKey ? { publicKey } : {}),
        addedAt: '2026-10-23T10:00:00Z',
      }
      state.sources = [...state.sources, source]
      return source
    }),
    removeSource: vi.fn(async (id: string) => {
      state.sources = state.sources.filter((s) => s.id !== id)
    }),
    getCatalog: vi.fn(async (sourceId: string) => {
      const catalog = state.catalogs[sourceId]
      if (!catalog) throw new Error(`unreachable: ${sourceId}`)
      return catalog
    }),
  } satisfies ExtensionsService
  return { service, state }
}
