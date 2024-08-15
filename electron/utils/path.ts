import { mkdir } from 'fs-extra'
import { existsSync } from 'fs'
import { getJanDataFolderPath } from '@janhq/core/node'

export async function createUserSpace(): Promise<void> {
  const janDataFolderPath = getJanDataFolderPath()
  if (!existsSync(janDataFolderPath)) {
    try {
      await mkdir(janDataFolderPath)
    } catch (err) {
      console.error(
        `Unable to create Jan data folder at ${janDataFolderPath}: ${err}`
      )
    }
  }
}
