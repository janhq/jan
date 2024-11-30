import { dirName, fs } from '@janhq/core'
import { scanModelsFolder } from './model-json'

export const deleteModelFiles = async (id: string) => {
  try {
    const models = await scanModelsFolder()
    const dirPath = models.find((e) => e.id === id)?.file_path
    // remove model folder directory
    if (dirPath) await fs.rm(await dirName(dirPath))
  } catch (err) {
    console.error(err)
  }
}
