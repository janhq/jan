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
    await assistants()?.createAssistant(assistant)
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    await assistants()?.deleteAssistant(assistant)
  }
}
