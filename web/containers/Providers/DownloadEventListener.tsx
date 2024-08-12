import { useCallback, useEffect, useRef } from 'react'

import { DownloadState2 } from '@janhq/core'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'

import { downloadStateListAtom } from '@/hooks/useDownloadState'

import { modelQueryKey } from '@/hooks/useModelQuery'

import { waitingForCortexAtom } from '@/helpers/atoms/App.atom'
import { hostAtom } from '@/helpers/atoms/AppConfig.atom'
import {
  setImportingModelSuccessAtom,
  updateImportingModelProgressAtom,
} from '@/helpers/atoms/Model.atom'

const DownloadEventListener: React.FC = () => {
  const host = useAtomValue(hostAtom)
  const isRegistered = useRef(false)
  const abortController = useRef(new AbortController())
  const setDownloadStateList = useSetAtom(downloadStateListAtom)
  const setWaitingForCortex = useSetAtom(waitingForCortexAtom)

  const updateImportingModelProgress = useSetAtom(
    updateImportingModelProgressAtom
  )
  const setImportingModelSuccess = useSetAtom(setImportingModelSuccessAtom)
  const queryClient = useQueryClient()

  const handleLocalImportModels = useCallback(
    (events: DownloadState2[]) => {
      if (events.length === 0) return
      for (const event of events) {
        if (event.progress === 100) {
          setImportingModelSuccess(event.id)
        } else {
          updateImportingModelProgress(event.id, event.progress)
        }
      }

      queryClient.invalidateQueries({ queryKey: modelQueryKey })
    },
    [setImportingModelSuccess, updateImportingModelProgress, queryClient]
  )

  const subscribeDownloadEvent = useCallback(async () => {
    if (isRegistered.current) return
    await fetchEventSource(`${host}/system/events/download`, {
      onmessage(ev) {
        if (!ev.data || ev.data === '') return
        try {
          const downloadEvents = JSON.parse(ev.data) as DownloadState2[]
          const remoteDownloadEvents: DownloadState2[] = []
          const localImportEvents: DownloadState2[] = []
          // filter out the import local events
          for (const event of downloadEvents) {
            if (
              isAbsolutePath(event.id) &&
              event.type === 'model' &&
              event.children.length === 0
            ) {
              localImportEvents.push(event)
            } else {
              remoteDownloadEvents.push(event)
            }
          }
          handleLocalImportModels(localImportEvents)
          setDownloadStateList(remoteDownloadEvents)
        } catch (err) {
          console.error(err)
        }
      },
      onerror(err) {
        if (err.message === 'Failed to fetch') {
          setWaitingForCortex(true)
        }
      },
      async onopen() {
        setWaitingForCortex(false)
      },
      signal: abortController.current.signal,
    })
    console.log('Download event subscribed')
    isRegistered.current = true
  }, [host, setDownloadStateList, setWaitingForCortex, handleLocalImportModels])

  const unsubscribeDownloadEvent = useCallback(() => {
    if (!isRegistered.current) return

    abortController.current.abort()
    isRegistered.current = false
    console.log('Download event unsubscribed')
  }, [])

  useEffect(() => {
    subscribeDownloadEvent()
    return () => {
      unsubscribeDownloadEvent()
    }
  }, [subscribeDownloadEvent, unsubscribeDownloadEvent])

  return null
}

const isAbsolutePath = (path: string): boolean => {
  // Trim any leading or trailing whitespace
  const trimmedPath = path.trim()

  // Check for Unix-like absolute path
  if (trimmedPath.startsWith('/')) {
    return true
  }

  // Check for Windows absolute path (with drive letter)
  if (/^[A-Za-z]:[/\\]/.test(trimmedPath)) {
    return true
  }

  // All other paths are not considered absolute local paths
  return false
}

export default DownloadEventListener
