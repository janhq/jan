import { useCallback } from 'react'

export const useLogs = () => {
  const getLogs = useCallback(async (file: string): Promise<string> => {
    console.log('getLogs', file)
    // const path = await joinPath(['file://logs', `${file}.log`])
    // if (!(await fs.existsSync(path))) return ''
    // const logs = await fs.readFileSync(path, 'utf-8')

    // const sanitizedLogs = logs.replace(
    //   new RegExp(`${janDataFolderPath}\\/`, 'g'),
    //   'jan-data-folder/'
    // )

    // return sanitizedLogs

    // TODO: @james - read from cortex log
    return Promise.resolve('')
  }, [])

  const openServerLog = useCallback(async () => {
    // const fullPath = await joinPath([janDataFolderPath, 'logs', 'app.log'])
    // return openFileExplorer(fullPath)
  }, [])

  const clearServerLog = useCallback(async () => {
    // await fs.writeFileSync(await joinPath(['file://logs', 'app.log']), '')
  }, [])

  return { getLogs, openServerLog, clearServerLog }
}
