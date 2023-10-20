import { store } from './storeService'
import { EventEmitter } from './eventsService'

export const setupCoreServices = () => {
  if (typeof window === 'undefined') {
    console.log('undefine', window)
    return
  } else {
    console.log('Setting up core services')
  }
  if (!window.corePlugin) {
    window.corePlugin = {
      store,
      events: new EventEmitter(),
    }
  }
  if (!window.coreAPI) {
    // fallback electron API
    window.coreAPI = window.electronAPI
  }
}
