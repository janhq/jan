import { fs, joinPath, openFileExplorer, getUserSpace } from '@janhq/core'

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
    const userSpace = await getUserSpace()
    const fullPath = await joinPath([userSpace, 'logs', 'server.log'])
    return openFileExplorer(fullPath)
  }

  const clearServerLog = async () => {
    await fs.writeFileSync(await joinPath(['file://logs', 'server.log']), '')
  }
  return { getServerLog, openServerLog, clearServerLog }
}
