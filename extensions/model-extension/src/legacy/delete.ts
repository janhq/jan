import { fs, joinPath } from '@janhq/core'

export const deleteModelFiles = async (id: string) => {
  try {
    const dirPath = await joinPath(['file://models', id])
    // remove model folder directory
    await fs.rm(dirPath)
  } catch (err) {
    console.error(err)
  }
}
