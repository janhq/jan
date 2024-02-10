import { useCallback, useEffect } from 'react'

import {
  Assistant,
  AssistantEvent,
  AssistantExtension,
  ExtensionTypeEnum,
  events,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'

const useAssistants = () => {
  const setAssistants = useSetAtom(assistantsAtom)

  const getData = useCallback(async () => {
    const assistants = await getLocalAssistants()
    setAssistants(assistants)
  }, [setAssistants])

  useEffect(() => {
    getData()

    events.on(AssistantEvent.OnAssistantsUpdate, () => getData())
    return () => {
      events.off(AssistantEvent.OnAssistantsUpdate, () => getData())
    }
  }, [getData])
}

const getLocalAssistants = async (): Promise<Assistant[]> =>
  extensionManager
    .get<AssistantExtension>(ExtensionTypeEnum.Assistant)
    ?.getAssistants() ?? []

export default useAssistants
