import {
  fs,
  joinPath,
  openFileExplorer,
  getJanDataFolderPath,
} from '@janhq/core'

export const useServerLog = () => {
  const getServerLog = async () => {
    if (!(await fs.existsSync(await joinPath(['file://logs', 'server.log']))))
      return {}
    const logs = await fs.readFileSync(
      await joinPath(['file://logs', 'server.log']),
      'utf-8'
    )

    return logs
  }
  const openServerLog = async () => {
    const janDataFolderPath = await getJanDataFolderPath()
    const fullPath = await joinPath([janDataFolderPath, 'logs', 'server.log'])
    return openFileExplorer(fullPath)
  }

  const clearServerLog = async () => {
    await fs.writeFileSync(await joinPath(['file://logs', 'server.log']), '')
  }
  return { getServerLog, openServerLog, clearServerLog }
}
