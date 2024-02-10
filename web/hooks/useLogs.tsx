import {
  fs,
  joinPath,
  openFileExplorer,
  getJanDataFolderPath,
} from '@janhq/core'

export const useLogs = () => {
  const getLogs = async (file: string) => {
    if (!(await fs.existsSync(await joinPath(['file://logs', `${file}.log`]))))
      return {}
    const logs = await fs.readFileSync(
      await joinPath(['file://logs', `${file}.log`]),
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
  return { getLogs, openServerLog, clearServerLog }
}
