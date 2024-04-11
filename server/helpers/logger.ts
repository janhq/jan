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

  info = function (msg: any) {
    log(msg)
  }
  error = function (msg: any) {
    log(msg)
  }
  debug = function (msg: any) {
    log(msg)
  }
  fatal = function (msg: any) {
    log(msg)
  }
  warn = function (msg: any) {
    log(msg)
  }
  trace = function (msg: any) {
    log(msg)
  }
}
