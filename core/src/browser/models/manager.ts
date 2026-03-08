import { Model, ModelEvent } from '../../types'
import { events } from '../events'

/**
 * Manages the registered models across extensions.
 */
export class ModelManager {
  public models = new Map<string, Model>()

  constructor() {
    if (window) {
      window.core.modelManager = this
    }
  }

  /**
   * Registers a model.
   * @param model - The model to register.
   */
  register<T extends Model>(model: T) {
    if (this.models.has(model.id)) {
      this.models.set(model.id, {
        ...model,
        ...this.models.get(model.id),
      })
    } else {
      this.models.set(model.id, model)
    }
    events.emit(ModelEvent.OnModelsUpdate, {})
  }

  /**
   * Retrieves a model by it's id.
   * @param id - The id of the model to retrieve.
   * @returns The model, if found.
   */
  get<T extends Model>(id: string): T | undefined {
    return this.models.get(id) as T | undefined
  }

  
  /**
   * Shared instance of ExtensionManager.
   */
  static instance() {
    if (!window.core.modelManager)
      window.core.modelManager = new ModelManager()
    return window.core.modelManager as ModelManager
  }
}
