import { invoke } from '@tauri-apps/api/core'

export { StreamEvent } from './types'

export async function checkFoundationModelsAvailability(): Promise<string> {
  return await invoke('plugin:foundation-models|check_foundation_models_availability')
}

export async function loadFoundationModels(modelId: string): Promise<void> {
  return await invoke('plugin:foundation-models|load_foundation_models', { modelId })
}

export async function unloadFoundationModels(): Promise<void> {
  return await invoke('plugin:foundation-models|unload_foundation_models')
}

export async function isFoundationModelsLoaded(): Promise<boolean> {
  return await invoke('plugin:foundation-models|is_foundation_models_loaded')
}

export async function foundationModelsChatCompletion(body: string): Promise<string> {
  return await invoke('plugin:foundation-models|foundation_models_chat_completion', { body })
}

export async function foundationModelsChatCompletionStream(
  body: string,
  requestId: string
): Promise<void> {
  return await invoke('plugin:foundation-models|foundation_models_chat_completion_stream', {
    body,
    requestId,
  })
}

export async function abortFoundationModelsStream(requestId: string): Promise<void> {
  return await invoke('plugin:foundation-models|abort_foundation_models_stream', { requestId })
}

export async function cleanupFoundationModelsProcesses(): Promise<void> {
  return await invoke('plugin:foundation-models|cleanup_foundation_models_processes')
}
