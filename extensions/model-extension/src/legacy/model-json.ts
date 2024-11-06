import { InferenceEngine, Model, fs, joinPath } from '@janhq/core'
//// LEGACY MODEL FOLDER ////
/**
 * Scan through models folder and return downloaded models
 * @returns
 */
export const scanModelsFolder = async (): Promise<Model[]> => {
  const _homeDir = 'file://models'
  try {
    if (!(await fs.existsSync(_homeDir))) {
      console.debug('Model folder not found')
      return []
    }

    const files: string[] = await fs.readdirSync(_homeDir)

    const allDirectories: string[] = []

    for (const modelFolder of files) {
      const fullModelFolderPath = await joinPath([_homeDir, modelFolder])
      if (!(await fs.fileStat(fullModelFolderPath)).isDirectory) continue
      allDirectories.push(modelFolder)
    }

    const readJsonPromises = allDirectories.map(async (dirName) => {
      // filter out directories that don't match the selector
      // read model.json
      const folderFullPath = await joinPath([_homeDir, dirName])

      const jsonPath = await getModelJsonPath(folderFullPath)

      if (await fs.existsSync(jsonPath)) {
        // if we have the model.json file, read it
        let model = await fs.readFileSync(jsonPath, 'utf-8')

        model = typeof model === 'object' ? model : JSON.parse(model)

        // This to ensure backward compatibility with `model.json` with `source_url`
        if (model['source_url'] != null) {
          model['sources'] = [
            {
              filename: model.id,
              url: model['source_url'],
            },
          ]
        }
        model.file_path = jsonPath
        model.file_name = 'model.json'

        // Check model file exist
        // model binaries (sources) are absolute path & exist (symlinked)
        const existFiles = await Promise.all(
          model.sources.map(
            (source) =>
              // Supposed to be a local file url
              !source.url.startsWith(`http://`) &&
              !source.url.startsWith(`https://`)
          )
        )
        if (existFiles.every((exist) => exist)) return model

        const result = await fs
          .readdirSync(await joinPath([_homeDir, dirName]))
          .then((files: string[]) => {
            // Model binary exists in the directory
            // Model binary name can match model ID or be a .gguf file and not be an incompleted model file
            return (
              files.includes(dirName) || // Legacy model GGUF without extension
              files.filter((file) => {
                return (
                  file.toLowerCase().endsWith('.gguf') || // GGUF
                  file.toLowerCase().endsWith('.engine') // Tensort-LLM
                )
              })?.length >= (model.engine === InferenceEngine.nitro_tensorrt_llm ? 1 : (model.sources?.length ?? 1))
            )
          })

        if (result) return model
        else return undefined
      }
    })
    const results = await Promise.allSettled(readJsonPromises)
    const modelData = results
      .map((result) => {
        if (result.status === 'fulfilled' && result.value) {
          try {
            const model =
              typeof result.value === 'object'
                ? result.value
                : JSON.parse(result.value)
            return model as Model
          } catch {
            console.debug(`Unable to parse model metadata: ${result.value}`)
          }
        }
        return undefined
      })
      .filter((e) => !!e)

    return modelData
  } catch (err) {
    console.error(err)
    return []
  }
}

/**
 * Retrieve the model.json path from a folder
 * @param folderFullPath
 * @returns
 */
export const getModelJsonPath = async (
  folderFullPath: string
): Promise<string | undefined> => {
  // try to find model.json recursively inside each folder
  if (!(await fs.existsSync(folderFullPath))) return undefined
  const files: string[] = await fs.readdirSync(folderFullPath)
  if (files.length === 0) return undefined
  if (files.includes('model.json')) {
    return joinPath([folderFullPath, 'model.json'])
  }
  // continue recursive
  for (const file of files) {
    const path = await joinPath([folderFullPath, file])
    const fileStats = await fs.fileStat(path)
    if (fileStats.isDirectory) {
      const result = await getModelJsonPath(path)
      if (result) return result
    }
  }
}
//// END LEGACY MODEL FOLDER ////
