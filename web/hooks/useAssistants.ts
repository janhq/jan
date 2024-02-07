import { useEffect } from 'react'

import { Assistant, AssistantExtension, ExtensionTypeEnum } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'

const useAssistants = () => {
  const setAssistants = useSetAtom(assistantsAtom)

  useEffect(() => {
    const getAssistants = async () => {
      const assistants = await getLocalAssistants()
      setAssistants(assistants)
    }

    getAssistants()
  }, [setAssistants])
}

const getLocalAssistants = async (): Promise<Assistant[]> =>
  extensionManager
    .get<AssistantExtension>(ExtensionTypeEnum.Assistant)
    ?.getAssistants() ?? []

export default useAssistants
