/**
 * Default Assistants Service - Web implementation
 */

import { getExtensionHost } from '@/lib/extensions/host'
import { ServiceKeys, type Assistant } from '@janhq/core'
import type { AssistantsService } from './types'

const assistants = () => getExtensionHost().services.get(ServiceKeys.Assistants)

export class DefaultAssistantsService implements AssistantsService {
  async getAssistants(): Promise<Assistant[] | null> {
    const service = assistants()

    if (!service) {
      console.warn('Assistants service not available')
      return null
    }

    return service.getAssistants()
  }

  async createAssistant(assistant: Assistant): Promise<void> {
    const service = assistants()
    if (!service) throw new Error('AssistantExtension not found')
    await service.createAssistant(assistant)
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    const service = assistants()
    if (!service) throw new Error('AssistantExtension not found')
    await service.deleteAssistant(assistant)
  }
}
