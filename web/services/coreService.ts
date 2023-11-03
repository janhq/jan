import { EventEmitter } from './eventsService'
import * as cn from './cloudNativeService'
export const setupCoreServices = () => {
  if (typeof window === 'undefined') {
    console.log('undefine', window)
    return
  } else {
    console.log('Setting up core services')
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
