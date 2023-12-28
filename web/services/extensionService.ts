/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { ExtensionType } from '@janhq/core'

import { extensionManager } from '@/extension/ExtensionManager'

export const isCoreExtensionInstalled = () => {
  if (!extensionManager.get(ExtensionType.Conversational)) {
    return false
  }
  if (!extensionManager.get(ExtensionType.Inference)) return false
  if (!extensionManager.get(ExtensionType.Model)) {
    return false
  }
  return true
}
export const setupBaseExtensions = async () => {
  if (typeof window === 'undefined') {
    return
  }
  const baseExtensions = await window.core?.api.baseExtensions()

  if (
    !extensionManager.get(ExtensionType.Conversational) ||
    !extensionManager.get(ExtensionType.Inference) ||
    !extensionManager.get(ExtensionType.Model)
  ) {
    const installed = await extensionManager.install(baseExtensions)
    if (installed) {
      window.location.reload()
    }
  }
}
