'use client'
import { extensionPoints, plugins } from '@plugin'
import {
  CoreService,
  InferenceService,
  ModelManagementService,
  PluginType,
  StoreService,
} from '@janhq/core'
import { pluginManager } from '@plugin/PluginManager'
import { InferencePlugin } from '@janhq/core/lib/plugins'

export const isCorePluginInstalled = () => {
  if (!extensionPoints.get(StoreService.CreateCollection)) {
    return false
  }
  if (!pluginManager.get<InferencePlugin>(PluginType.Inference)) return false
  if (!extensionPoints.get(ModelManagementService.DownloadModel)) {
    return false
  }
  return true
}
export const setupBasePlugins = async () => {
  if (
    typeof window === 'undefined' ||
    typeof window.electronAPI === 'undefined'
  ) {
    return
  }
  const basePlugins = await window.electronAPI.basePlugins()

  if (
    !extensionPoints.get(StoreService.CreateCollection) ||
    !pluginManager.get<InferencePlugin>(PluginType.Inference) ||
    !extensionPoints.get(ModelManagementService.DownloadModel)
  ) {
    const installed = await plugins.install(basePlugins)
    if (installed) {
      window.location.reload()
    }
  }
}

export const execute = (name: CoreService, args?: any) => {
  if (!extensionPoints.get(name)) {
    // alert('Missing extension for function: ' + name)
    return undefined
  }
  return extensionPoints.execute(name, args)
}

export const executeSerial = (name: CoreService, args?: any) => {
  if (!extensionPoints.get(name)) {
    // alert('Missing extension for function: ' + name)
    return Promise.resolve(undefined)
  }
  return extensionPoints.executeSerial(name, args)
}
