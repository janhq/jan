import { log } from '@janhq/core/node'
import { FastifyBaseLogger } from 'fastify'
import { ChildLoggerOptions } from 'fastify/types/logger'
import pino from 'pino'

export class Logger implements FastifyBaseLogger {
  child(
    bindings: pino.Bindings,
    options?: ChildLoggerOptions | undefined
  ): FastifyBaseLogger {
    return new Logger()
  }
  level = 'info'

  silent = () => {}

  info = (obj?: any, msg?: string, ...args: any[]) => {
    if (obj?.res?.raw?.statusCode || obj?.req?.url) {
      log(
        `[SERVER]::${JSON.stringify({
          level: obj?.level,
          time: obj?.time,
          hostname: obj?.hostname,
          reqId: obj?.req?.id ?? obj?.res?.request?.id,
          res: {
            statusCode: obj?.res?.raw?.statusCode,
          },
          req: {
            method: obj?.req?.method,
            url: obj?.req?.url,
            path: obj?.req?.path,
            hostname: obj?.req?.hostname,
            remoteAddress: obj?.req?.remoteAddress,
            remotePort: obj?.req?.remotePort,
          },
          msg,
          responseTime: obj?.responseTime,
          ...args,
        })}`
      )
    }
  }
  error = function (message: any) {
    log(`[SERVER]::${JSON.stringify(message)}`)
  }
  debug = function (message: any) {
    log(`[SERVER]::${JSON.stringify(message)}`)
  }
  fatal = function (message: any) {
    log(`[SERVER]::${JSON.stringify(message)}`)
  }
  warn = function (message: any) {
    log(`[SERVER]::${JSON.stringify(message)}`)
  }
  trace = function (message: any) {
    log(`[SERVER]::${JSON.stringify(message)}`)
  }
}
