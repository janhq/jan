import { EngineManager, ToolManager } from '@janhq/core'

import { appService } from './appService'
import { EventEmitter } from './eventsService'
import { restAPI } from './restService'

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
      engineManager: new EngineManager(),
      toolManager: new ToolManager(),
      api: {
        ...(window.electronAPI ? window.electronAPI : restAPI),
        ...appService,
      },
    }
  }
}
