import { useCallback } from 'react'

import { fs, joinPath, openFileExplorer } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { appConfigurationAtom } from '@/helpers/atoms/AppConfig.atom'

export const useLogs = () => {
  const appConfig = useAtomValue(appConfigurationAtom)

  const getLogs = useCallback(
    async (file: string) => {
      const path = await joinPath(['file://logs', `${file}.log`])
      if (!(await fs.existsSync(path))) return ''
      const logs = await fs.readFileSync(path, 'utf-8')

      const sanitizedLogs = logs.replace(
        new RegExp(`${appConfig?.data_folder ?? ''}\\/`, 'g'),
        'jan-data-folder/'
      )

      return sanitizedLogs
    },
    [appConfig]
  )

  const openServerLog = useCallback(async () => {
    const fullPath = await joinPath([
      appConfig?.data_folder ?? '',
      'logs',
      'server.log',
    ])
    return openFileExplorer(fullPath)
  }, [appConfig])

  const clearServerLog = useCallback(async () => {
    await fs.writeFileSync(await joinPath(['file://logs', 'server.log']), '')
  }, [])

  return { getLogs, openServerLog, clearServerLog }
}
