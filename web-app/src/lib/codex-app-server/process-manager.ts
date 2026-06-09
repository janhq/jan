import { buildCodexSpawnCommand } from './config'
import { CodexJsonRpcClient } from './json-rpc'
import type {
  CodexInitializeResult,
  CodexProcess,
  CodexSessionOptions,
} from './types'

export type CodexSpawnOptions = {
  cwd: string
  env: Record<string, string | undefined>
  codexHome?: string
  configToml?: string
}

export interface CodexProcessSpawner {
  spawn(
    command: string,
    args: string[],
    options: CodexSpawnOptions
  ): CodexProcess | Promise<CodexProcess>
}

export class CodexAppServerProcessManager {
  private process: CodexProcess | null = null
  private client: CodexJsonRpcClient | null = null
  private initializePromise: Promise<CodexInitializeResult> | null = null
  private currentGeneration = 0

  constructor(
    private readonly spawner: CodexProcessSpawner,
    private readonly options: CodexSessionOptions
  ) {}

  get rpc() {
    if (!this.client) {
      throw new Error('Codex app-server has not been started')
    }
    return this.client
  }

  get generation() {
    return this.currentGeneration
  }

  get isRunning() {
    return Boolean(this.client && !this.client.isClosed)
  }

  initialize() {
    if (this.initializePromise && this.isRunning) return this.initializePromise

    const command = buildCodexSpawnCommand(this.options)
    this.initializePromise = Promise.resolve(
      this.spawner.spawn(command.command, command.args, {
        cwd: command.cwd,
        env: command.env,
        codexHome: command.codexHome,
        configToml: command.configToml,
      })
    )
      .then(async (process) => {
        this.process = process
        const client = new CodexJsonRpcClient(process)
        this.client = client

        try {
          const result = await client.request<CodexInitializeResult>('initialize', {
            clientInfo: { name: 'jan', title: 'Jan', version: VERSION },
            capabilities: {
              experimentalApi: true,
              requestAttestation: false,
            },
          })
          client.notify('initialized')
          this.currentGeneration += 1
          return result
        } catch (error) {
          await this.cleanupFailedInitialize(process, client)
          throw error
        }
      })
      .catch((error) => {
        this.initializePromise = null
        throw error
      })

    return this.initializePromise
  }

  async restart() {
    await this.shutdown()
    return this.initialize()
  }

  async shutdown() {
    this.client?.close()
    await this.process?.kill()
    this.client = null
    this.process = null
    this.initializePromise = null
  }

  private async cleanupFailedInitialize(
    process: CodexProcess,
    client: CodexJsonRpcClient
  ) {
    client.close()
    await process.kill()
    if (this.client === client) this.client = null
    if (this.process === process) this.process = null
  }
}
