'use client'
import { PluginType } from '@janhq/core'
import { pluginManager } from '@plugin/PluginManager'

export const isCorePluginInstalled = () => {
  if (!pluginManager.get(PluginType.Conversational)) {
    return false
  }
  if (!pluginManager.get(PluginType.Inference)) return false
  if (!pluginManager.get(PluginType.Model)) {
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
    !pluginManager.get(PluginType.Conversational) ||
    !pluginManager.get(PluginType.Inference) ||
    !pluginManager.get(PluginType.Model)
  ) {
    const installed = await pluginManager.install(basePlugins)
    if (installed) {
      window.location.reload()
    }
  }
}
