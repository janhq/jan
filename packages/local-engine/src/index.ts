/**
 * Shared base for Jan's local CPU inference engines.
 *
 * Both engines Jan supports here — LiteRT-LM and OpenVINO — are driven the
 * same way: a python sidecar loads the model and serves the OpenAI
 * chat-completions API on localhost, and the extension talks to it over HTTP.
 * This module holds that shared behaviour; the per-engine extension only has
 * to say which provider it is and where its models live.
 *
 * Model layout on disk (inside Jan's data folder):
 *
 *   <data>/<engine>/models/<model id>/model.yml   metadata
 *   <data>/<engine>/models/<model id>/<file>      the model itself
 *
 * `model.yml` mirrors the llama.cpp layout so the same import/export tooling
 * works across engines:
 *
 *   name: Qwen3 0.6B
 *   model_path: model.litertlm
 *   size_bytes: 344671744
 *   embedding: false
 */

import {
  AIEngine,
  fs,
  joinPath,
  getJanDataFolderPath,
  modelInfo,
  SessionInfo,
  UnloadResult,
  chatCompletion,
  chatCompletionChunk,
  chatCompletionRequest,
  ImportOptions,
  events,
  DownloadEvent,
  logger,
} from '@janhq/core'
import {
  loadLocalModel,
  unloadLocalModel,
  getLocalLoadedModels,
  findLocalSessionByModel,
  checkLocalEngine,
  installLocalEngineRuntime,
  LocalEngineConfig,
} from '@janhq/tauri-plugin-local-engine-api'

/** The contents of a model's `model.yml`. */
export interface LocalEngineModelConfig {
  name?: string
  model_path: string
  size_bytes?: number
  embedding?: boolean
}

/** A running engine session. */
interface EngineSession {
  modelId: string
  port: number
  apiKey: string
  pid: number
}

/**
 * An AI engine that runs a model in a local sidecar process and talks to it
 * over the OpenAI chat-completions API.
 */
export abstract class LocalEngineExtension extends AIEngine {
  /** The provider id, e.g. `litert-lm`. */
  abstract readonly providerId: string

  /** Unload the previous model when a new one is loaded. */
  autoUnload: boolean = true

  /** How long to wait for a model to come up, in seconds. */
  timeout: number = 600

  /** Context window handed to the engine. */
  ctxSize: number = 4096

  /** Threads handed to the engine; 0 lets the runtime decide. */
  threads: number = 0

  /** The settings schema, injected by the extension bundle. */
  settingsSchema: unknown = []

  private providerPath = ''
  private sessions = new Map<string, EngineSession>()

  override async onLoad(): Promise<void> {
    super.onLoad()
    this.registerSettings(structuredClone(this.settingsSchema as any))
    this.providerPath = await joinPath([
      await getJanDataFolderPath(),
      this.providerId,
    ])
    await fs.mkdir(await this.modelsDir())
    logger.info(`${this.providerId} extension loaded`)

    // Report the runtime's state at startup: it is the one thing that can
    // make the engine unusable, and it is invisible until a model is picked.
    const runtime = await this.isRuntimeAvailable()
    if (runtime.available) {
      logger.info(`${this.providerId} runtime is ready`)
    } else {
      logger.warn(
        `${this.providerId} runtime is not available: ${runtime.error ?? 'unknown reason'}`
      )
    }
  }

  /** Applies a settings change to the engine configuration. */
  override onSettingUpdate<T>(key: string, value: T): void {
    switch (key) {
      case 'auto_unload':
        this.autoUnload = Boolean(value)
        break
      case 'ctx_size':
        this.ctxSize = Number(value) || this.ctxSize
        break
      case 'threads':
        this.threads = Number(value) || 0
        break
      default:
        break
    }
  }

  /** The directory holding this engine's models. */
  async modelsDir(): Promise<string> {
    return joinPath([this.providerPath, 'models'])
  }

  /** The directory of one model. */
  async modelDir(modelId: string): Promise<string> {
    return joinPath([await this.modelsDir(), modelId])
  }

  /**
   * Whether the engine's runtime is installed and usable on this machine.
   * The UI shows the reason when it is not, so the user knows what to install.
   */
  async isRuntimeAvailable(): Promise<{ available: boolean; error?: string }> {
    try {
      const result = await checkLocalEngine(
        this.providerId,
        await this.dataFolder()
      )
      return { available: result.available, error: result.error }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Installs the engine's runtime into a virtualenv Jan manages.
   *
   * Resolves with the path of the interpreter that was set up; the engine
   * picks it up from then on.
   */
  async installRuntime(): Promise<string> {
    return await installLocalEngineRuntime(
      this.providerId,
      await this.dataFolder()
    )
  }

  /**
   * Jan's data folder.
   *
   * The plugin keeps the runtime and the sidecar script next to the models,
   * so a data folder the user moved still holds everything together.
   */
  private async dataFolder(): Promise<string> {
    return await getJanDataFolderPath()
  }

  /** Reads a model's metadata. */
  async readModelConfig(modelId: string): Promise<LocalEngineModelConfig | undefined> {
    const path = await joinPath([await this.modelDir(modelId), 'model.yml'])
    if (!(await fs.existsSync(path))) return undefined
    try {
      return await fs.readYaml<LocalEngineModelConfig>(path)
    } catch (error) {
      logger.warn(`Failed to read model config for ${modelId}:`, error)
      return undefined
    }
  }

  /** The absolute path of a model's weights. */
  async resolveModelPath(modelId: string): Promise<string | undefined> {
    const config = await this.readModelConfig(modelId)
    if (!config?.model_path) return undefined
    if (this.isAbsolutePath(config.model_path)) return config.model_path
    return joinPath([await this.modelDir(modelId), config.model_path])
  }

  protected isAbsolutePath(path: string): boolean {
    return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
  }

  override async get(modelId: string): Promise<modelInfo | undefined> {
    const config = await this.readModelConfig(modelId)
    if (!config) return undefined
    const path = await this.resolveModelPath(modelId)
    return {
      id: modelId,
      name: config.name ?? modelId,
      providerId: this.providerId,
      port: this.sessions.get(modelId)?.port ?? 0,
      sizeBytes: config.size_bytes ?? 0,
      embedding: config.embedding ?? false,
      path,
    } as modelInfo
  }

  override async list(): Promise<modelInfo[]> {
    const modelsDir = await this.modelsDir()
    if (!(await fs.existsSync(modelsDir))) {
      await fs.mkdir(modelsDir)
      return []
    }

    const modelIds: string[] = []
    const stack = [modelsDir]
    while (stack.length > 0) {
      const currentDir = stack.pop() as string
      if (await fs.existsSync(await joinPath([currentDir, 'model.yml']))) {
        modelIds.push(currentDir.slice(modelsDir.length + 1))
        continue
      }
      let children: string[] = []
      try {
        children = await fs.readdirSync(currentDir)
      } catch {
        continue
      }
      for (const child of children) {
        // readdirSync hands back full paths.
        try {
          const info = await fs.fileStat(child)
          if (info?.isDirectory) stack.push(child)
        } catch {
          // A file we cannot stat is not a model directory; skip it.
        }
      }
    }

    const models: modelInfo[] = []
    for (const modelId of modelIds) {
      const info = await this.get(modelId)
      if (info) models.push(info)
    }
    return models
  }

  override async load(
    modelId: string,
    settings?: any,
    isEmbedding?: boolean,
    bypassAutoUnload?: boolean
  ): Promise<SessionInfo> {
    if (this.autoUnload && !bypassAutoUnload) {
      for (const [id, session] of this.sessions) {
        if (id !== modelId) {
          await this.unload(String(session.pid)).catch(() => undefined)
        }
      }
    }

    const modelPath = await this.resolveModelPath(modelId)
    if (!modelPath) {
      throw new Error(`No model file configured for '${modelId}'`)
    }

    const config: LocalEngineConfig = {
      // The models service renames the per-model `ctx_len` setting to
      // `ctx_size` before handing it over; the extension's own setting uses
      // the same name.
      ctx_size:
        Number(settings?.ctx_size ?? settings?.ctx_len ?? this.ctxSize) ||
        this.ctxSize,
      threads: this.threads,
    }

    const session = await loadLocalModel(
      this.providerId,
      modelId,
      modelPath,
      0, // the plugin picks a free port
      config,
      this.timeout,
      await this.dataFolder()
    )

    this.sessions.set(modelId, {
      modelId,
      port: session.port,
      apiKey: session.api_key,
      pid: session.pid,
    })

    return {
      pid: session.pid,
      port: session.port,
      model_id: modelId,
      is_embedding: isEmbedding ?? false,
      api_key: session.api_key,
    }
  }

  /**
   * Stops the engine session for a model.
   *
   * The model service hands over the model id; the session id (the sidecar's
   * pid) is accepted too, so either can be used.
   */
  override async unload(modelOrSessionId: string): Promise<UnloadResult> {
    let pid: number | undefined
    for (const [modelId, session] of this.sessions) {
      if (modelId === modelOrSessionId || String(session.pid) === modelOrSessionId) {
        pid = session.pid
        this.sessions.delete(modelId)
        break
      }
    }

    if (pid === undefined) {
      const session = await findLocalSessionByModel(modelOrSessionId).catch(
        () => null
      )
      if (!session) {
        return {
          success: false,
          error: `No running session for '${modelOrSessionId}'`,
        }
      }
      pid = session.pid
    }

    return await unloadLocalModel(pid)
  }

  override async getLoadedModels(): Promise<string[]> {
    const fromPlugin = await getLocalLoadedModels().catch(() => [] as string[])
    return fromPlugin.length > 0 ? fromPlugin : [...this.sessions.keys()]
  }

  override async isToolSupported(_modelId: string): Promise<boolean> {
    // Neither runtime exposes a tool-call API yet.
    return false
  }

  /**
   * The session for a model, or the only running session when the model is
   * not named.
   */
  private sessionFor(modelId: string | undefined): EngineSession | undefined {
    if (modelId) {
      const exact = this.sessions.get(modelId)
      if (exact) return exact
    }
    const [first] = this.sessions.values()
    return first
  }

  override async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    const session = this.sessionFor(opts.model)
    if (!session) {
      throw new Error(`No running ${this.providerId} session`)
    }

    const body = {
      model: opts.model || session.modelId,
      messages: opts.messages?.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      stream: opts.stream !== false,
      temperature: opts.temperature ?? undefined,
      top_p: opts.top_p ?? undefined,
      max_tokens: opts.n_predict ?? undefined,
      stop: opts.stop ?? undefined,
    }

    const response = await fetch(`http://127.0.0.1:${session.port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abortController?.signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `The ${this.providerId} engine returned ${response.status}${text ? `: ${text}` : ''}`
      )
    }

    if (body.stream === false) {
      return (await response.json()) as chatCompletion
    }

    return this.streamChunks(response, opts.model || session.modelId)
  }

  /** Reads the server-sent events of a streaming completion. */
  private async *streamChunks(
    response: Response,
    model: string
  ): AsyncIterable<chatCompletionChunk> {
    const reader = response.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const chunk = this.parseEvent(raw, model)
        if (chunk) yield chunk
        boundary = buffer.indexOf('\n\n')
      }
    }
  }

  /** Turns one SSE frame into a chat completion chunk. */
  private parseEvent(raw: string, model: string): chatCompletionChunk | undefined {
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload)
        if (parsed.error) {
          throw new Error(parsed.error.message ?? 'The engine reported an error')
        }
        const choice = parsed.choices?.[0]
        if (!choice) continue
        const delta = choice.delta ?? {}
        // The engine sends the model's thinking in `reasoning_content`.
        const content = delta.content ?? delta.reasoning_content ?? ''
        return {
          id: parsed.id ?? 'chatcmpl-local',
          object: 'chat.completion.chunk',
          created: parsed.created ?? Math.floor(Date.now() / 1000),
          model: parsed.model ?? model,
          choices: [
            {
              index: choice.index ?? 0,
              delta: {
                role: delta.role,
                content: content || undefined,
              },
              finish_reason: choice.finish_reason ?? null,
            },
          ],
        } as chatCompletionChunk
      } catch (error) {
        if (error instanceof SyntaxError) continue
        throw error
      }
    }
    return undefined
  }

  override async delete(modelId: string): Promise<void> {
    const session = this.sessions.get(modelId)
    if (session) {
      await this.unload(String(session.pid)).catch(() => undefined)
    }
    await fs.rm(await this.modelDir(modelId))
  }

  override async update(modelId: string, model: Partial<modelInfo>): Promise<void> {
    const config = (await this.readModelConfig(modelId)) ?? { model_path: '' }
    await fs.writeYaml(await joinPath([await this.modelDir(modelId), 'model.yml']), {
      ...config,
      name: model.name ?? config.name ?? modelId,
      size_bytes: model.sizeBytes ?? config.size_bytes ?? 0,
      embedding: model.embedding ?? config.embedding ?? false,
    })
  }

  override async import(modelId: string, opts: ImportOptions): Promise<void> {
    const source = opts.modelPath
    if (!source) {
      throw new Error('No model file to import')
    }

    const modelDir = await this.modelDir(modelId)
    await fs.mkdir(modelDir)

    let modelPath: string
    if (source.startsWith('https://')) {
      // A remote model is downloaded into the engine's own models directory
      // by the download manager, the same way llama.cpp does it.
      const fileName = source.split('/').pop()?.split('?')[0] || 'model.bin'
      const savePath = `${this.providerId}/models/${modelId}/${fileName}`
      await this.download(source, savePath, modelId, opts.modelSha256, opts.modelSize)
      modelPath = fileName
    } else {
      // A local file is referenced where it is; copying hundreds of megabytes
      // into the data folder would be pointless.
      if (!(await fs.existsSync(source))) {
        throw new Error(`File not found: ${source}`)
      }
      modelPath = source
    }

    const stat = modelPath.startsWith('http')
      ? undefined
      : await fs.fileStat(modelPath)
    await fs.writeYaml(await joinPath([modelDir, 'model.yml']), {
      name: modelId,
      model_path: modelPath,
      size_bytes: stat?.size ?? opts.modelSize ?? 0,
      embedding: false,
    })
  }

  /** Downloads a model file through Jan's download manager. */
  private async download(
    url: string,
    savePath: string,
    modelId: string,
    sha256?: string,
    size?: number
  ): Promise<void> {
    const downloadManager = window.core.extensionManager.getByName(
      '@janhq/download-extension'
    )
    if (!downloadManager) {
      throw new Error('The download extension is not available')
    }

    const onProgress = (transferred: number, total: number) => {
      events.emit(DownloadEvent.onFileDownloadUpdate, {
        modelId,
        percent: total > 0 ? transferred / total : 0,
        size: { transferred, total },
        downloadType: 'Model',
      })
    }

    await downloadManager.downloadFiles(
      [
        {
          url,
          save_path: savePath,
          sha256,
          size,
          model_id: modelId,
        },
      ],
      `${this.providerId}-${modelId}`,
      onProgress
    )
  }

  override async abortImport(_modelId: string): Promise<void> {
    // Imports are local file copies; there is nothing to abort.
  }
}
