import * as cn from './cloudNativeService'
import { EventEmitter } from './eventsService'
export const setupCoreServices = () => {
  if (typeof window === 'undefined') {
    console.debug('undefine', window)
    return
  } else {
    console.debug('Setting up core services')
  }
  if (!window.corePlugin) {
    window.corePlugin = {
      events: new EventEmitter(),
    }
    window.coreAPI = {}
    window.coreAPI = window.electronAPI ?? {
      invokePluginFunc: cn.invokePluginFunc,
      downloadFile: cn.downloadFile,
      deleteFile: cn.deleteFile,
      appVersion: cn.appVersion,
      openExternalUrl: cn.openExternalUrl,
    }
  }
}
