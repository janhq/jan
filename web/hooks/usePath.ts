import { openFileExplorer, joinPath, baseName } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { selectedModelAtom } from '@/containers/DropdownListSidebar'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

export const usePath = () => {
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  const onRevealInFinder = async (type: string) => {
    // TODO: this logic should be refactored.
    if (type !== 'Model' && !activeThread) return

    let filePath = undefined
    const assistantId = activeThread?.assistants[0]?.assistant_id
    switch (type) {
      case 'Engine':
      case 'Thread':
        filePath = await joinPath(['threads', activeThread?.id ?? ''])
        break
      case 'Model':
        if (!selectedModel) return
        filePath = await joinPath(['models', selectedModel.id])
        break
      case 'Tools':
      case 'Assistant':
        if (!assistantId) return
        filePath = await joinPath(['assistants', assistantId])
        break
      default:
        break
    }

    if (!filePath) return
    const fullPath = await joinPath([janDataFolderPath, filePath])
    openFileExplorer(fullPath)
  }

  const onViewJson = async (type: string) => {
    // TODO: this logic should be refactored.
    if (type !== 'Model' && !activeThread) return

    let filePath = undefined
    const assistantId = activeThread?.assistants[0]?.assistant_id
    switch (type) {
      case 'Engine':
      case 'Thread':
        filePath = await joinPath([
          'threads',
          activeThread?.id ?? '',
          'thread.json',
        ])
        break
      case 'Model':
        if (!selectedModel) return
        filePath = await joinPath(['models', selectedModel.id, 'model.json'])
        break
      case 'Assistant':
      case 'Tools':
        if (!assistantId) return
        filePath = await joinPath(['assistants', assistantId, 'assistant.json'])
        break
      default:
        break
    }

    if (!filePath) return
    const fullPath = await joinPath([janDataFolderPath, filePath])
    openFileExplorer(fullPath)
  }

  const onViewFile = async (id: string) => {
    if (!activeThread) return

    let filePath = undefined

    id = await baseName(id)
    filePath = await joinPath(['threads', `${activeThread.id}/files`, `${id}`])
    if (!filePath) return
    const fullPath = await joinPath([janDataFolderPath, filePath])
    openFileExplorer(fullPath)
  }

  const onViewFileContainer = async () => {
    if (!activeThread) return

    let filePath = undefined
    filePath = await joinPath(['threads', `${activeThread.id}/files`])
    if (!filePath) return
    const fullPath = await joinPath([janDataFolderPath, filePath])
    openFileExplorer(fullPath)
  }

  return {
    onRevealInFinder,
    onViewJson,
    onViewFile,
    onViewFileContainer,
  }
}
