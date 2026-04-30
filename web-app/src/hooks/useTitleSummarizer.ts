import { useCallback, useRef } from 'react'
import { useThreads } from '@/hooks/useThreads'
import { generateThreadTitle } from '@/lib/thread-title-summarizer'

const MAX_TITLE_SUMMARIZATION_ATTEMPTS = 3
const TITLE_SUMMARIZATION_MIN_LENGTH = 50

export function useTitleSummarizer(threadId: string) {
  const titleAbortRef = useRef<AbortController | null>(null)
  const titleAttemptsRef = useRef(0)

  const summarizeTitle = useCallback(() => {
    const currentThread = useThreads.getState().threads[threadId]
    if (
      !currentThread ||
      currentThread.metadata?.titleSummarized ||
      titleAttemptsRef.current >= MAX_TITLE_SUMMARIZATION_ATTEMPTS
    ) {
      return
    }

    const titleText = currentThread.title
    if (!titleText) return

    if (titleText.length < TITLE_SUMMARIZATION_MIN_LENGTH) {
      useThreads.getState().updateThread(threadId, {
        metadata: { ...currentThread.metadata, titleSummarized: true },
      })
      return
    }

    titleAbortRef.current?.abort()
    const controller = new AbortController()
    titleAbortRef.current = controller
    titleAttemptsRef.current += 1
    const originalTitle = titleText

    generateThreadTitle(titleText, controller.signal).then((title) => {
      if (!title || controller.signal.aborted) return
      const thread = useThreads.getState().threads[threadId]
      if (!thread || thread.title !== originalTitle) return
      useThreads.getState().updateThread(threadId, {
        title,
        metadata: { ...thread.metadata, titleSummarized: true },
      })
      titleAbortRef.current = null
    })
  }, [threadId])

  const resetTitleSummarizer = useCallback(() => {
    titleAbortRef.current?.abort()
    titleAbortRef.current = null
    titleAttemptsRef.current = 0
  }, [])

  const abortTitleSummarization = useCallback(() => {
    titleAbortRef.current?.abort()
    titleAbortRef.current = null
  }, [])

  return { summarizeTitle, resetTitleSummarizer, abortTitleSummarization }
}
