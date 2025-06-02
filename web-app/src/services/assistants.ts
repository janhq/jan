import { ExtensionManager } from '@/lib/extension'
import { Assistant, AssistantExtension, ExtensionTypeEnum } from '@janhq/core'

/**
 * Fetches all available assistants.
 * @returns A promise that resolves to the assistants.
 */
export const getAssistants = async () => {
  const extension = ExtensionManager.getInstance().get<AssistantExtension>(
    ExtensionTypeEnum.Assistant
  )

  if (!extension) {
    console.warn('AssistantExtension not found')
    return null
  }

  return extension.getAssistants()
}

/**
 * Creates a new assistant.
 * @param assistant The assistant to create.
 */
export const createAssistant = async (assistant: Assistant) => {
  return ExtensionManager.getInstance()
    .get<AssistantExtension>(ExtensionTypeEnum.Assistant)
    ?.createAssistant(assistant)
}
/**
 * Deletes an existing assistant.
 * @param assistant The assistant to delete.
 * @return A promise that resolves when the assistant is deleted.
 */
export const deleteAssistant = async (assistant: Assistant) => {
  return ExtensionManager.getInstance()
    .get<AssistantExtension>(ExtensionTypeEnum.Assistant)
    ?.deleteAssistant(assistant)
}
