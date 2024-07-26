'use client'

import { useCallback, useEffect } from 'react'

import { useAtomValue, useSetAtom } from 'jotai'

import useAssistantQuery from '@/hooks/useAssistantQuery'
import useThreads from '@/hooks/useThreads'

import { toaster } from '../Toast'

import {
  MainViewState,
  mainViewStateAtom,
  showLeftPanelAtom,
  showRightPanelAtom,
} from '@/helpers/atoms/App.atom'
import { getSelectedModelAtom } from '@/helpers/atoms/Model.atom'

const KeyListener: React.FC = () => {
  const setShowLeftPanel = useSetAtom(showLeftPanelAtom)
  const setShowRightPanel = useSetAtom(showRightPanelAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { createThread } = useThreads()

  const { data: assistants } = useAssistantQuery()

  const selectedModel = useAtomValue(getSelectedModelAtom)

  const createNewThread = useCallback(() => {
    if (!selectedModel) {
      toaster({
        title: 'No model selected.',
        description: 'Please select a model to create a new thread.',
        type: 'error',
      })
      return
    }

    if (!assistants || assistants.length === 0) {
      toaster({
        title: 'No assistant available.',
        description: 'Please create an assistant to create a new thread',
        type: 'error',
      })
      return
    }

    createThread(selectedModel.model, assistants[0])
    setMainViewState(MainViewState.Thread)
  }, [selectedModel, createThread, assistants, setMainViewState])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const prefixKey = isMac ? e.metaKey : e.ctrlKey

      if (e.key === 'b' && prefixKey && e.shiftKey) {
        setShowRightPanel((showRightideBar) => !showRightideBar)
        return
      }

      if (e.key === 'n' && prefixKey) {
        return createNewThread()
      }

      if (e.key === 'b' && prefixKey) {
        setShowLeftPanel((showLeftSideBar) => !showLeftSideBar)
        return
      }

      if (e.key === ',' && prefixKey) {
        setMainViewState(MainViewState.Settings)
        return
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    assistants,
    setShowRightPanel,
    selectedModel,
    createThread,
    setMainViewState,
    setShowLeftPanel,
    createNewThread,
  ])

  return null
}

export default KeyListener
