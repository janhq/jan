import { useCallback } from 'react'

import { fs, joinPath, openFileExplorer } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'

export const useLogs = () => {
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)

  const getLogs = useCallback(
    async (file: string) => {
      const path = await joinPath(['file://logs', `${file}.log`])
      if (!(await fs.existsSync(path))) return ''
      const logs = await fs.readFileSync(path, 'utf-8')

      const sanitizedLogs = logs.replace(
        new RegExp(`${janDataFolderPath}\\/`, 'g'),
        'jan-data-folder/'
      )

      return sanitizedLogs
    },
    [janDataFolderPath]
  )

  const openServerLog = useCallback(async () => {
    const fullPath = await joinPath([janDataFolderPath, 'logs', 'server.log'])
    return openFileExplorer(fullPath)
  }, [janDataFolderPath])

  const clearServerLog = useCallback(async () => {
    await fs.writeFileSync(await joinPath(['file://logs', 'server.log']), '')
  }, [])

  return { getLogs, openServerLog, clearServerLog }
}
