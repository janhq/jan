import { vi } from 'vitest'
import type { PermissionString } from '@janhq/extension-api'
import { manifest } from '@/lib/extensions/__tests__/fixtures'
import type {
  Catalog,
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
  const m = manifest(id, { displayName: `Ext ${id}` })
  return {
    id,
    manifest: m,
    enabled: true,
    version: m.version,
    previous: null,
    source: { kind: 'bundle', fileName: `${id}.tgz`, sha512: 'sha512-abc' },
    verified: false,
    integrityChecked: false,
    granted: [],
    permissions: m.permissions,
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
    integrityChecked: false,
    source: { kind: 'bundle', fileName: `${id}.tgz`, sha512: 'sha512-c3RhZ2Vk' },
    permissionDiff: { added: permissions, removed: [] },
    ...extra,
  }
}

export interface MockState {
  safeMode: boolean
  extensions: InstalledExtension[]
  sources: IndexSource[]
  catalogs: Record<string, Catalog>
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
          version: stage.manifest.version,
          granted,
          permissions: stage.manifest.permissions,
          verified: stage.verified,
          integrityChecked: stage.integrityChecked,
          source: stage.source,
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
      safeModeForced: false,
      recoveredFrom: null,
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
      ;[entry.version, entry.previous] = [entry.previous, entry.version]
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
    acceptNextKey: vi.fn(async (sourceId: string, nextPublicKey: string) => {
      const source = state.sources.find((s) => s.id === sourceId)
      if (!source) throw new Error(`no source: ${sourceId}`)
      const rotated = { ...source, publicKey: nextPublicKey }
      state.sources = state.sources.map((s) => (s.id === sourceId ? rotated : s))
      const catalog = state.catalogs[sourceId]
      if (catalog) state.catalogs[sourceId] = { ...catalog, nextPublicKey: null }
      return rotated
    }),
  } satisfies ExtensionsService
  return { service, state }
}
