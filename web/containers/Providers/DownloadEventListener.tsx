import { useCallback, useEffect, useRef } from 'react'

import { DownloadState2 } from '@janhq/core'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { useAtomValue, useSetAtom } from 'jotai'

import { downloadStateListAtom } from '@/hooks/useDownloadState'

import { waitingForCortexAtom } from '@/helpers/atoms/App.atom'
import { hostAtom } from '@/helpers/atoms/AppConfig.atom'

const DownloadEventListener: React.FC = () => {
  const host = useAtomValue(hostAtom)
  const isRegistered = useRef(false)
  const abortController = useRef(new AbortController())
  const setDownloadStateList = useSetAtom(downloadStateListAtom)
  const setWaitingForCortex = useSetAtom(waitingForCortexAtom)

  const subscribeDownloadEvent = useCallback(async () => {
    if (isRegistered.current) return
    await fetchEventSource(`${host}/system/events/download`, {
      onmessage(ev) {
        if (!ev.data || ev.data === '') return
        try {
          const downloadEvent = JSON.parse(ev.data) as DownloadState2[]
          setDownloadStateList(downloadEvent)
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
  }, [host, setDownloadStateList, setWaitingForCortex])

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

export default DownloadEventListener
