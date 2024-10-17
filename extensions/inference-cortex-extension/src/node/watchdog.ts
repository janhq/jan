import { log } from '@janhq/core/node'
import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

interface WatchdogOptions {
  cwd?: string
  restartDelay?: number
  maxRestarts?: number
  env?: NodeJS.ProcessEnv
}

export class ProcessWatchdog extends EventEmitter {
  private command: string
  private args: string[]
  private options: WatchdogOptions
  private process: ChildProcess | null
  private restartDelay: number
  private maxRestarts: number
  private restartCount: number
  private isTerminating: boolean

  constructor(command: string, args: string[], options: WatchdogOptions = {}) {
    super()
    this.command = command
    this.args = args
    this.options = options
    this.process = null
    this.restartDelay = options.restartDelay || 5000
    this.maxRestarts = options.maxRestarts || 5
    this.restartCount = 0
    this.isTerminating = false
  }

  start(): void {
    this.spawnProcess()
  }

  private spawnProcess(): void {
    if (this.isTerminating) return

    log(`Starting process: ${this.command} ${this.args.join(' ')}`)
    this.process = spawn(this.command, this.args, this.options)

    this.process.stdout?.on('data', (data: Buffer) => {
      log(`Process output: ${data}`)
      this.emit('output', data.toString())
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      log(`Process error: ${data}`)
      this.emit('error', data.toString())
    })

    this.process.on('close', (code: number | null) => {
      log(`Process exited with code ${code}`)
      this.emit('close', code)
      if (!this.isTerminating) {
        this.restartProcess()
      }
    })
  }

  private restartProcess(): void {
    if (this.restartCount < this.maxRestarts) {
      this.restartCount++
      log(
        `Restarting process in ${this.restartDelay}ms (Attempt ${this.restartCount}/${this.maxRestarts})`
      )
      setTimeout(() => this.spawnProcess(), this.restartDelay)
    } else {
      log('Max restart attempts reached. Exiting watchdog.')
      this.emit('maxRestartsReached')
    }
  }

  terminate(): void {
    this.isTerminating = true
    if (this.process) {
      log('Terminating watched process...')
      this.process.kill()
    }
    this.emit('terminated')
  }
}
