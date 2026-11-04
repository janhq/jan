import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SettingContribution } from '@janhq/extension-api'
import { ExtensionHost } from '@/lib/extensions/host'
import { builtin, manifest } from '@/lib/extensions/__tests__/fixtures'
import {
  memoryAppSettings,
  memorySecrets,
} from '@/lib/extensions/__tests__/memory'
import rag from '../../../../extensions/rag-extension/package.json'

const hostRef = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock('@/lib/extensions/host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/extensions/host')>()),
  getExtensionHost: () => hostRef.current,
}))

import {
  RAG_EXTENSION_ID,
  initAttachments,
  useAttachments,
} from '../useAttachments'

const settings = rag.jan.contributes.settings as SettingContribution[]
const initial = useAttachments.getState()

let host: ExtensionHost
let appSettings: ReturnType<typeof memoryAppSettings>
let stop: (() => void) | undefined

async function activateRag() {
  await host.activateBuiltin(
    builtin(manifest(RAG_EXTENSION_ID, { contributes: { settings } }), {
      activate: () => undefined,
    })
  )
}

const stored = () =>
  JSON.parse(appSettings.data.get(`extension:${RAG_EXTENSION_ID}:settings`) ?? '{}')

beforeEach(() => {
  appSettings = memoryAppSettings()
  host = new ExtensionHost({
    appSettings,
    secrets: memorySecrets(),
    notify: vi.fn(),
  })
  hostRef.current = host
  useAttachments.setState(initial, true)
})

afterEach(async () => {
  stop?.()
  stop = undefined
  await host.deactivateAll()
})

describe('useAttachments', () => {
  it('has the manifest defaults before anything loads', () => {
    const state = useAttachments.getState()
    expect(state).toMatchObject({
      enabled: true,
      maxFileSizeMB: 100,
      retrievalLimit: 3,
      retrievalThreshold: 0.3,
      chunkSizeChars: 512,
      overlapChars: 64,
      searchMode: 'auto',
      parseMode: 'auto',
      autoInlineContextRatio: 0.75,
    })
    expect(state.settingsDefs).toEqual([])
  })

  it('returns false while the rag built-in is not active', async () => {
    expect(await useAttachments.getState().loadSettingsDefs()).toBe(false)
  })

  it('loads the stored values and one def per declared setting', async () => {
    appSettings.data.set(
      `extension:${RAG_EXTENSION_ID}:settings`,
      JSON.stringify({ enabled: false, retrieval_limit: 5, search_mode: 'linear' })
    )
    await activateRag()
    expect(await useAttachments.getState().loadSettingsDefs()).toBe(true)
    const state = useAttachments.getState()
    expect(state).toMatchObject({
      enabled: false,
      retrievalLimit: 5,
      searchMode: 'linear',
      maxFileSizeMB: 100,
    })
    expect(state.settingsDefs.map((d) => d.key)).toEqual(settings.map((s) => s.key))
  })

  it('renders numeric settings as number inputs with their range and i18n keys', async () => {
    await activateRag()
    await useAttachments.getState().loadSettingsDefs()
    const def = useAttachments
      .getState()
      .settingsDefs.find((d) => d.key === 'max_file_size_mb')
    expect(def).toMatchObject({
      controllerType: 'input',
      titleKey: 'settings:attachments.maxFile',
      descriptionKey: 'settings:attachments.maxFileDesc',
      controllerProps: { type: 'number', min: 1, max: 200, step: 1, value: 100 },
    })
    const mode = useAttachments
      .getState()
      .settingsDefs.find((d) => d.key === 'search_mode')
    expect(mode).toMatchObject({
      controllerType: 'dropdown',
      controllerProps: { value: 'auto' },
    })
  })

  describe('setters write to the host settings store', () => {
    const cases = [
      ['setEnabled', 'enabled', 'enabled', false],
      ['setMaxFileSizeMB', 'max_file_size_mb', 'maxFileSizeMB', 99],
      ['setRetrievalLimit', 'retrieval_limit', 'retrievalLimit', 7],
      ['setRetrievalThreshold', 'retrieval_threshold', 'retrievalThreshold', 0.7],
      ['setChunkSizeChars', 'chunk_size_chars', 'chunkSizeChars', 2048],
      ['setOverlapChars', 'overlap_chars', 'overlapChars', 256],
      ['setSearchMode', 'search_mode', 'searchMode', 'linear'],
      ['setParseMode', 'parse_mode', 'parseMode', 'embeddings'],
      ['setAutoInlineContextRatio', 'auto_inline_context_ratio', 'autoInlineContextRatio', 0.45],
    ] as const

    for (const [name, key, field, value] of cases) {
      it(`${name} persists ${key} and updates the store`, async () => {
        await activateRag()
        stop = initAttachments()
        await vi.waitFor(() =>
          expect(useAttachments.getState().settingsDefs.length).toBeGreaterThan(0)
        )
        const setter = useAttachments.getState()[name] as (v: typeof value) => Promise<void>
        await setter(value)
        expect(stored()[key]).toBe(value)
        expect(useAttachments.getState()[field]).toBe(value)
        const def = useAttachments.getState().settingsDefs.find((d) => d.key === key)
        expect(def?.controllerProps.value).toBe(value)
      })
    }

    it('keeps the stored value when the store refuses one outside the declared range', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await activateRag()
      await useAttachments.getState().setRetrievalLimit(500)
      expect(stored().retrieval_limit).toBeUndefined()
      expect(useAttachments.getState().retrievalLimit).toBe(3)
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe('initAttachments', () => {
    it('loads once the rag built-in activates', async () => {
      stop = initAttachments()
      expect(useAttachments.getState().settingsDefs).toEqual([])
      await activateRag()
      await vi.waitFor(() =>
        expect(useAttachments.getState().settingsDefs.length).toBe(settings.length)
      )
    })

    it('follows changes made elsewhere, such as Settings > Extensions', async () => {
      await activateRag()
      stop = initAttachments()
      await host.settings.setSettingValue(RAG_EXTENSION_ID, 'parse_mode', 'inline')
      expect(useAttachments.getState().parseMode).toBe('inline')
    })

    it('ignores other extensions and stops following when disposed', async () => {
      await activateRag()
      stop = initAttachments()
      stop()
      stop = undefined
      await host.settings.setSettingValue(RAG_EXTENSION_ID, 'parse_mode', 'inline')
      expect(useAttachments.getState().parseMode).toBe('auto')
    })
  })
})
