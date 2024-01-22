/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { ExtensionTypeEnum } from '@janhq/core'

import { extensionManager } from '@/extension/ExtensionManager'

export const isCoreExtensionInstalled = () => {
  if (!extensionManager.get(ExtensionTypeEnum.Conversational)) {
    return false
  }
  if (!extensionManager.get(ExtensionTypeEnum.Inference)) return false
  if (!extensionManager.get(ExtensionTypeEnum.Model)) {
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
    !extensionManager.get(ExtensionTypeEnum.Conversational) ||
    !extensionManager.get(ExtensionTypeEnum.Inference) ||
    !extensionManager.get(ExtensionTypeEnum.Model)
  ) {
    const installed = await extensionManager.install(baseExtensions)
    if (installed) {
      window.location.reload()
    }
  }
}
