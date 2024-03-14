import { getJanDataFolderPath, joinPath } from '../../core'
import { events } from '../../events'
import { BaseExtension } from '../../extension'
import { fs } from '../../fs'
import { Model, ModelEvent } from '../../types'

/**
 * Base AIEngine
 * Applicable to all AI Engines
 */
export abstract class AIEngine extends BaseExtension {
  // The inference engine
  abstract provider: string
  // The model folder
  modelFolder: string = 'models'

  abstract models(): Promise<Model[]>

  /**
   * On extension load, subscribe to events.
   */
  onLoad() {
    this.prePopulateModels()
  }

  /**
   * Pre-populate models to App Data Folder
   */
  prePopulateModels(): Promise<void> {
    return this.models().then((models) => {
      const prePoluateOperations = models.map((model) =>
        getJanDataFolderPath()
          .then((janDataFolder) =>
            // Attempt to create the model folder
            joinPath([janDataFolder, this.modelFolder, model.id]).then((path) =>
              fs
                .mkdirSync(path)
                .catch()
                .then(() => path)
            )
          )
          .then((path) => joinPath([path, 'model.json']))
          .then((path) => {
            // Do not overwite existing model.json
            return fs.existsSync(path).then((exist: any) => {
              if (!exist) return fs.writeFileSync(path, JSON.stringify(model, null, 2))
            })
          })
          .catch((e: Error) => {
            console.error('Error', e)
          })
      )
      Promise.all(prePoluateOperations).then(() =>
        // Emit event to update models
        // So the UI can update the models list
        events.emit(ModelEvent.OnModelsUpdate, {})
      )
    })
  }
}
