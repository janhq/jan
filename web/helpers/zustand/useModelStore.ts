import { Model, ModelEvent, events } from '@janhq/core'
import { create } from 'zustand'

type ModelState = 'active' | 'inactive' | 'starting' | 'stopping' | 'error'

type ModelLoadingError = {
  errorCode: string
  message: string
}

type ModelWithState = Model & {
  state: ModelState

  loadingError?: ModelLoadingError
}

type ModelStore = {
  activeModel?: ModelWithState

  startModel: (model: Model) => void
}

const useModelStore = create<ModelStore>()((set, get) => ({
  activeModel: undefined,

  startModel: async (model: Model) => {
    const currentActiveModel = get().activeModel
    if (currentActiveModel && currentActiveModel.id === model.id) {
      // TODO: there are cases:
      // - model is starting/stopping -> ignore
      // - model active but settings params changed -> need to restart
      console.debug(`Model ${model.id} is already initialized. Ignore..`)
      return
    }

    // // TODO: incase we have multiple assistants, the configuration will be from assistant
    // setLoadModelError(undefined)

    // setActiveModel(undefined)

    // setStateModel({ state: 'start', loading: true, model: modelId })

    // let model = downloadedModelsRef?.current.find((e) => e.id === modelId)

    // if (!model) {
    //   toaster({
    //     title: `Model ${modelId} not found!`,
    //     description: `Please download the model first.`,
    //     type: 'warning',
    //   })
    //   setStateModel(() => ({
    //     state: 'start',
    //     loading: false,
    //     model: '',
    //   }))
    //   return
    // }

    /// Apply thread model settings
    // if (activeThread?.assistants[0]?.model.id === modelId) {
    //   model = {
    //     ...model,
    //     settings: {
    //       ...model.settings,
    //       ...activeThread.assistants[0].model.settings,
    //     },
    //   }
    // }
    // TODO: reading thread json and get the model settings

    // localStorage.setItem(LAST_USED_MODEL_ID, model.id)
    events.emit(ModelEvent.OnModelInit, model)
  },

  // stopModel: async () => {
  //   if (get().activeModel) {
  //     setActiveModel(undefined)
  //     setStateModel({ state: 'stop', loading: true, model: activeModel.id })
  //     events.emit(ModelEvent.OnModelStop, activeModel)
  //   }
  // },
}))
