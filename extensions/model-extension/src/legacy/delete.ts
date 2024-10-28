import { fs, joinPath, Model } from "@janhq/core"

export const deleteModelFiles = async (model: Model) => {
    try {
        const dirPath = await joinPath(['file://models', model.id])

        // remove all files under dirPath except model.json
        const files = await fs.readdirSync(dirPath)
        const deletePromises = files.map(async (fileName: string) => {
            if (fileName !== 'model.json') {
                return fs.unlinkSync(await joinPath([dirPath, fileName]))
            }
        })
        await Promise.allSettled(deletePromises)
    } catch (err) {
        console.error(err)
    }
}