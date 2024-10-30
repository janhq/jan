import { fs, joinPath, Model } from '@janhq/core'

export const deleteModelFiles = async (model: Model) => {
  try {
    const dirPath = await joinPath(['file://models', model.id])
    // remove model folder directory
    await fs.unlinkSync(dirPath)
  } catch (err) {
    console.error(err)
  }
}
