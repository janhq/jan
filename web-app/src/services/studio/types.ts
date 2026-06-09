export type BinaryProbeResult = {
  found: boolean
  path?: string
}

export type EndpointProbeResult = {
  reachable: boolean
  statusCode?: number
  modelCount?: number
  error?: string
}

export type StudioRuntimeProcess = {
  runtimeId: string
  pid: number
  model?: string
  baseUrl: string
  logPath: string
}

export type StudioService = {
  probeBinaryOnPath(binary: string): Promise<BinaryProbeResult>
  probeOpenaiEndpoint(
    baseUrl: string,
    apiKey?: string
  ): Promise<EndpointProbeResult>
  listRuntimeProcesses(): Promise<StudioRuntimeProcess[]>
  spawnRuntime(
    runtimeId: string,
    model: string,
    baseUrl: string
  ): Promise<StudioRuntimeProcess>
  stopRuntime(runtimeId: string): Promise<void>
  readRuntimeLogs(runtimeId: string): Promise<string>
}
