import * as restAPI from './cloudNativeService'
import { EventEmitter } from './eventsService'
export const setupCoreServices = () => {
  if (typeof window === 'undefined') {
    console.debug('undefine', window)
    return
  } else {
    console.debug('Setting up core services')
  }
  if (!window.core) {
    window.core = {
      events: new EventEmitter(),
      api: window.electronAPI ?? {
        ...restAPI,
      },
    }
  }
}
