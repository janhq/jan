import { getUserSpace, openFileExplorer, joinPath } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'

import { activeThreadAtom, threadStatesAtom } from '@/helpers/atoms/Thread.atom'

export const usePath = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const threadStates = useAtomValue(threadStatesAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  const onReviewInFinder = async (type: string) => {
    if (!activeThread) return
    const activeThreadState = threadStates[activeThread.id]
    if (!activeThreadState.isFinishInit) {
      alert('Thread is not started yet')
      return
    }

    const userSpace = await getUserSpace()
    let filePath = undefined
    const assistantId = activeThread.assistants[0]?.assistant_id
    switch (type) {
      case 'Engine':
      case 'Thread':
        filePath = await joinPath(['threads', activeThread.id])
        break
      case 'Model':
        if (!selectedModel) return
        filePath = await joinPath(['models', selectedModel.id])
        break
      case 'Assistant':
        if (!assistantId) return
        filePath = await joinPath(['assistants', assistantId])
        break
      default:
        break
    }

    if (!filePath) return
    const fullPath = await joinPath([userSpace, filePath])
    openFileExplorer(fullPath)
  }

  const onViewJson = async (type: string) => {
    if (!activeThread) return
    const activeThreadState = threadStates[activeThread.id]
    if (!activeThreadState.isFinishInit) {
      alert('Thread is not started yet')
      return
    }

    const userSpace = await getUserSpace()
    let filePath = undefined
    const assistantId = activeThread.assistants[0]?.assistant_id
    switch (type) {
      case 'Engine':
      case 'Thread':
        filePath = await joinPath(['threads', activeThread.id, 'thread.json'])
        break
      case 'Model':
        if (!selectedModel) return
        filePath = await joinPath(['models', selectedModel.id, 'model.json'])
        break
      case 'Assistant':
        if (!assistantId) return
        filePath = await joinPath(['assistants', assistantId, 'assistant.json'])
        break
      default:
        break
    }

    if (!filePath) return
    const fullPath = await joinPath([userSpace, filePath])
    openFileExplorer(fullPath)
  }

  const onViewFile = async (id: string) => {
    if (!activeThread) return
    const activeThreadState = threadStates[activeThread.id]
    if (!activeThreadState.isFinishInit) {
      alert('Thread is not started yet')
      return
    }

    const userSpace = await getUserSpace()
    let filePath = undefined
    filePath = await joinPath(['threads', `${activeThread.id}/files`, `${id}`])
    if (!filePath) return
    const fullPath = await joinPath([userSpace, filePath])
    openFileExplorer(fullPath)
  }

  return {
    onReviewInFinder,
    onViewJson,
    onViewFile,
  }
}
