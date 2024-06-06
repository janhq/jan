'use client'

import { useEffect } from 'react'

import { useAtomValue, useSetAtom } from 'jotai'

import { MainViewState } from '@/constants/screens'

import useThreads from '@/hooks/useThreads'

import { toaster } from '../Toast'

import {
  mainViewStateAtom,
  showLeftPanelAtom,
  showRightPanelAtom,
} from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { getSelectedModelAtom } from '@/helpers/atoms/Model.atom'

const KeyListener: React.FC = () => {
  const setShowLeftPanel = useSetAtom(showLeftPanelAtom)
  const setShowRightPanel = useSetAtom(showRightPanelAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const { createThread } = useThreads()

  const assistants = useAtomValue(assistantsAtom)
  const selectedModel = useAtomValue(getSelectedModelAtom)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const prefixKey = isMac ? e.metaKey : e.ctrlKey

      if (e.key === 'b' && prefixKey && e.shiftKey) {
        setShowRightPanel((showRightideBar) => !showRightideBar)
        return
      }

      if (e.key === 'n' && prefixKey) {
        if (!selectedModel) {
          toaster({
            title: 'No model selected.',
            description: 'Please select a model to create a new thread.',
            type: 'error',
          })
          return
        }

        createThread(selectedModel.id, assistants[0])
        setMainViewState(MainViewState.Thread)
        return
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
  ])

  return null
}

export default KeyListener
