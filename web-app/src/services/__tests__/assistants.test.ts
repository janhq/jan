import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ServiceKeys,
  createServiceRegistry,
  type Assistant,
  type AssistantService,
  type ServiceRegistry,
} from '@janhq/core'
import { DefaultAssistantsService } from '../assistants/default'

const h = vi.hoisted(() => ({ services: undefined as unknown }))

vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({ services: h.services }),
}))

const assistant = (id: string) =>
  ({ id, name: id, description: id }) as unknown as Assistant

describe('DefaultAssistantsService', () => {
  let assistantsService: DefaultAssistantsService
  let services: ServiceRegistry
  const impl = {
    getAssistants: vi.fn(),
    createAssistant: vi.fn(),
    deleteAssistant: vi.fn(),
  } satisfies AssistantService

  beforeEach(() => {
    vi.clearAllMocks()
    services = createServiceRegistry()
    h.services = services
    assistantsService = new DefaultAssistantsService()
  })

  const provide = () => services.provide(ServiceKeys.Assistants, impl)

  describe('getAssistants', () => {
    it('returns the assistants of the provided Assistants service', async () => {
      provide()
      const list = [assistant('a1'), assistant('a2')]
      impl.getAssistants.mockResolvedValue(list)
      await expect(assistantsService.getAssistants()).resolves.toEqual(list)
    })

    it('returns null and warns when no Assistants service is provided', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await expect(assistantsService.getAssistants()).resolves.toBeNull()
      expect(warn).toHaveBeenCalledWith('Assistants service not available')
      warn.mockRestore()
    })

    it('propagates a failure of the service', async () => {
      provide()
      impl.getAssistants.mockRejectedValue(new Error('Failed to get assistants'))
      await expect(assistantsService.getAssistants()).rejects.toThrow(
        'Failed to get assistants'
      )
    })
  })

  describe('createAssistant', () => {
    it('delegates to the Assistants service', async () => {
      provide()
      impl.createAssistant.mockResolvedValue(undefined)
      const a = assistant('new')
      await expect(assistantsService.createAssistant(a)).resolves.toBeUndefined()
      expect(impl.createAssistant).toHaveBeenCalledWith(a)
    })

    it('does nothing when no Assistants service is provided', async () => {
      await expect(
        assistantsService.createAssistant(assistant('new'))
      ).resolves.toBeUndefined()
      expect(impl.createAssistant).not.toHaveBeenCalled()
    })

    it('propagates a failure of the service', async () => {
      provide()
      impl.createAssistant.mockRejectedValue(new Error('Failed to create assistant'))
      await expect(
        assistantsService.createAssistant(assistant('new'))
      ).rejects.toThrow('Failed to create assistant')
    })
  })

  describe('deleteAssistant', () => {
    it('delegates to the Assistants service', async () => {
      provide()
      impl.deleteAssistant.mockResolvedValue(undefined)
      const a = assistant('gone')
      await expect(assistantsService.deleteAssistant(a)).resolves.toBeUndefined()
      expect(impl.deleteAssistant).toHaveBeenCalledWith(a)
    })

    it('does nothing when no Assistants service is provided', async () => {
      await expect(
        assistantsService.deleteAssistant(assistant('gone'))
      ).resolves.toBeUndefined()
      expect(impl.deleteAssistant).not.toHaveBeenCalled()
    })

    it('propagates a failure of the service', async () => {
      provide()
      impl.deleteAssistant.mockRejectedValue(new Error('Failed to delete assistant'))
      await expect(
        assistantsService.deleteAssistant(assistant('gone'))
      ).rejects.toThrow('Failed to delete assistant')
    })
  })
})
