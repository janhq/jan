import { openFileExplorer, joinPath, baseName } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { getFileInfo } from '@/utils/file'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

export const usePath = () => {
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)

  const onRevealInFinder = async (type: string) => {
    // TODO: this logic should be refactored.
    if (type !== 'Model' && !activeThread) return

    let filePath = undefined
    const assistantId = activeAssistant?.assistant_id
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
      case 'Logs':
        filePath = 'logs'
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

    id = await baseName(id)

    // New ID System
    if (!id.startsWith('file-')) {
      const threadFilePath = await joinPath([
        janDataFolderPath,
        'threads',
        `${activeThread.id}/files`,
        id,
      ])
      openFileExplorer(threadFilePath)
    } else {
      id = id.split('.')[0]
      const fileName = (await getFileInfo(id)).filename
      const filesPath = await joinPath([janDataFolderPath, 'files', fileName])
      openFileExplorer(filesPath)
    }
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
    onViewFile,
    onViewFileContainer,
  }
}
