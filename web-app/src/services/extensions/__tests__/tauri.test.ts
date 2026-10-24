import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  InstalledExtension,
  StagedInstall,
} from '@janhq/tauri-plugin-extensions-api'

const plugin = vi.hoisted(() => ({
  stageBundle: vi.fn(),
  stageFromIndex: vi.fn(),
  confirmInstall: vi.fn(),
  discardStage: vi.fn(async () => undefined),
  list: vi.fn(),
  setEnabled: vi.fn(async () => undefined),
  setGrants: vi.fn(async () => undefined),
  uninstall: vi.fn(async () => undefined),
  rollback: vi.fn(),
  setSafeMode: vi.fn(async () => undefined),
  listSources: vi.fn(async () => []),
  addSource: vi.fn(),
  removeSource: vi.fn(async () => undefined),
  getCatalog: vi.fn(),
}))
vi.mock('@janhq/tauri-plugin-extensions-api', () => plugin)

import { TauriExtensionsService } from '../tauri'

const ID = 'acme.hello'

const packageJson = (version = '1.0.0', jan: Record<string, unknown> = {}) => ({
  name: '@acme/hello',
  version,
  jan: {
    id: ID,
    displayName: 'Hello',
    publisher: 'Acme',
    apiVersion: '^0.1.0',
    main: 'dist/index.js',
    permissions: ['ui:notify'],
    ...jan,
  },
})

const installed = (extra: Partial<InstalledExtension> = {}): InstalledExtension => ({
  id: ID,
  version: '1.0.0',
  previous: null,
  enabled: true,
  granted: ['ui:notify'],
  permissions: ['ui:notify'],
  source: { kind: 'bundle', fileName: 'hello.tgz', sha512: 'sha512-a' },
  verified: false,
  integrityChecked: false,
  installedAt: '2026-10-23T10:00:00Z',
  manifest: packageJson(),
  ...extra,
})

const staged = (extra: Partial<StagedInstall> = {}): StagedInstall => ({
  stageId: 's1',
  manifest: packageJson(),
  sha512: 'sha512-a',
  verified: false,
  integrityChecked: false,
  source: { kind: 'bundle', fileName: 'hello.tgz', sha512: 'sha512-a' },
  existing: null,
  permissionDiff: { added: ['ui:notify'], removed: [] },
  ...extra,
})

describe('TauriExtensionsService', () => {
  const service = new TauriExtensionsService()

  beforeEach(() => vi.clearAllMocks())

  it('has an install pipeline', () => {
    expect(service.isSupported()).toBe(true)
  })

  it('returns a stage with the manifest validated by the host', async () => {
    plugin.stageBundle.mockResolvedValue(staged())
    const result = await service.stageBundle('/tmp/hello.tgz')
    expect(plugin.stageBundle).toHaveBeenCalledWith('/tmp/hello.tgz')
    expect(result.manifest).toMatchObject({
      id: ID,
      version: '1.0.0',
      permissions: ['ui:notify'],
    })
    expect(result.existing).toBeUndefined()
    expect(result.permissionDiff).toEqual({ added: ['ui:notify'], removed: [] })
  })

  it('keeps what an update replaces', async () => {
    plugin.stageFromIndex.mockResolvedValue(
      staged({ existing: { version: '0.9.0', granted: ['ui:notify'] } })
    )
    const result = await service.stageFromIndex('src', ID, '1.0.0')
    expect(plugin.stageFromIndex).toHaveBeenCalledWith('src', ID, '1.0.0')
    expect(result.existing).toEqual({ version: '0.9.0', granted: ['ui:notify'] })
  })

  it('discards a stage whose manifest the host refuses', async () => {
    plugin.stageBundle.mockResolvedValue(
      staged({ manifest: packageJson('1.0.0', { apiVersion: 'latest' }) })
    )
    await expect(service.stageBundle('/tmp/x.tgz')).rejects.toThrow(
      /jan\.apiVersion/
    )
    expect(plugin.discardStage).toHaveBeenCalledWith('s1')
  })

  it('lists the registry with typed manifests and leaves out unreadable ones', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    plugin.list.mockResolvedValue({
      safeMode: true,
      safeModeForced: false,
      recoveredFrom: '/x/extensions.json.corrupt-1',
      extensions: [
        installed(),
        installed({ id: 'acme.broken', manifest: null }),
      ],
    })
    const result = await service.list()
    expect(result.safeMode).toBe(true)
    expect(result.recoveredFrom).toBe('/x/extensions.json.corrupt-1')
    expect(result.extensions).toHaveLength(1)
    expect(result.extensions[0]).toMatchObject({
      id: ID,
      version: '1.0.0',
      manifest: { id: ID, displayName: 'Hello' },
    })
  })

  it('passes changes through with the same arguments', async () => {
    plugin.confirmInstall.mockResolvedValue(installed())
    plugin.rollback.mockResolvedValue(installed({ version: '0.9.0', manifest: packageJson('0.9.0') }))
    await service.confirmInstall('s1', ['ui:notify'])
    await service.setEnabled(ID, false)
    await service.setGrants(ID, [])
    await expect(service.rollback(ID)).resolves.toMatchObject({ version: '0.9.0' })
    await service.uninstall(ID)
    await service.setSafeMode(true)
    expect(plugin.confirmInstall).toHaveBeenCalledWith('s1', ['ui:notify'])
    expect(plugin.setEnabled).toHaveBeenCalledWith(ID, false)
    expect(plugin.setGrants).toHaveBeenCalledWith(ID, [])
    expect(plugin.uninstall).toHaveBeenCalledWith(ID)
    expect(plugin.setSafeMode).toHaveBeenCalledWith(true)
  })

  it('turns plugin rejections into errors with their message', async () => {
    plugin.setGrants.mockRejectedValueOnce({
      kind: 'denied',
      message: "'tools' is not granted",
    })
    await expect(service.setGrants(ID, ['tools'])).rejects.toThrow(
      "'tools' is not granted"
    )
  })
})
