import { invoke } from '@tauri-apps/api/core'

import type {
  BinaryProbeResult,
  EndpointProbeResult,
  StudioRuntimeProcess,
  StudioService,
} from './types'

export class DefaultStudioService implements StudioService {
  async probeBinaryOnPath(binary: string): Promise<BinaryProbeResult> {
    return invoke<BinaryProbeResult>('probe_binary_on_path', { binary })
  }

  async probeOpenaiEndpoint(
    baseUrl: string,
    apiKey?: string
  ): Promise<EndpointProbeResult> {
    return invoke<EndpointProbeResult>('probe_openai_endpoint', {
      baseUrl,
      apiKey,
    })
  }

  async listRuntimeProcesses(): Promise<StudioRuntimeProcess[]> {
    return invoke<StudioRuntimeProcess[]>('list_studio_runtime_processes')
  }

  async spawnRuntime(
    runtimeId: string,
    model: string,
    baseUrl: string
  ): Promise<StudioRuntimeProcess> {
    return invoke<StudioRuntimeProcess>('spawn_studio_runtime', {
      runtimeId,
      model,
      baseUrl,
    })
  }

  async stopRuntime(runtimeId: string): Promise<void> {
    return invoke('stop_studio_runtime', { runtimeId })
  }

  async readRuntimeLogs(runtimeId: string): Promise<string> {
    return invoke<string>('read_studio_runtime_logs', { runtimeId })
  }
}
