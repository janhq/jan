import { useCallback, useEffect } from 'react'

import { AssistantEvent, events } from '@janhq/core'
import { useSetAtom } from 'jotai'

import useCortex from './useCortex'

import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'

const useAssistants = () => {
  const setAssistants = useSetAtom(assistantsAtom)
  const { fetchAssistants } = useCortex()

  const getData = useCallback(async () => {
    const assistants = await fetchAssistants()
    setAssistants(assistants)
  }, [setAssistants, fetchAssistants])

  useEffect(() => {
    getData()

    events.on(AssistantEvent.OnAssistantsUpdate, () => getData())
    return () => {
      events.off(AssistantEvent.OnAssistantsUpdate, () => getData())
    }
  }, [getData])
}

export default useAssistants
