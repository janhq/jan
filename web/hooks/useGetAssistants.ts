import { useEffect, useState } from 'react'

import { Assistant, PluginType } from '@janhq/core'

import { AssistantPlugin } from '@janhq/core/lib/plugins'

import { pluginManager } from '@/plugin/PluginManager'

const getAssistants = async (): Promise<Assistant[]> => {
  return (
    pluginManager.get<AssistantPlugin>(PluginType.Assistant)?.getAssistants() ??
    []
  )
}

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
