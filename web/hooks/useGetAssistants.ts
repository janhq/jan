import { useEffect, useState } from 'react'

import { Assistant, ExtensionType, AssistantExtension } from '@janhq/core'

import { extensionManager } from '@/extension/ExtensionManager'

export const getAssistants = async (): Promise<Assistant[]> =>
  extensionManager
    .get<AssistantExtension>(ExtensionType.Assistant)
    ?.getAssistants() ?? []

/**
 * Hooks for get assistants
 *
 * @returns assistants
 */
export default function useGetAssistants() {
  const [assistants, setAssistants] = useState<Assistant[]>([])

  useEffect(() => {
    getAssistants()
      .then((data) => {
        setAssistants(data)
      })
      .catch((err) => {
        console.error(err)
      })
  }, [])

  return { assistants }
}
