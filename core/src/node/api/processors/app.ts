import { basename, dirname, isAbsolute, join, relative } from 'path'

import { Processor } from './Processor'
import {
  log as writeLog,
  getAppConfigurations as appConfiguration,
  updateAppConfiguration,
  normalizeFilePath,
  getJanDataFolderPath,
} from '../../helper'

export class App implements Processor {
  observer?: Function

  constructor(observer?: Function) {
    this.observer = observer
  }

  process(key: string, ...args: any[]): any {
    const instance = this as any
    const func = instance[key]
    return func(...args)
  }

  /**
   * Joins multiple paths together, respect to the current OS.
   */
  joinPath(args: any[]) {
    return join(...args)
  }

  /**
   * Get dirname of a file path.
   * @param path - The file path to retrieve dirname.
   */
  dirName(path: string) {
    const arg =
      path.startsWith(`file:/`) || path.startsWith(`file:\\`)
        ? join(getJanDataFolderPath(), normalizeFilePath(path))
        : path
    return dirname(arg)
  }

  /**
   * Checks if the given path is a subdirectory of the given directory.
   *
   * @param _event - The IPC event object.
   * @param from - The path to check.
   * @param to - The directory to check against.
   *
   * @returns {Promise<boolean>} - A promise that resolves with the result.
   */
  isSubdirectory(from: any, to: any) {
    const rel = relative(from, to)
    const isSubdir = rel && !rel.startsWith('..') && !isAbsolute(rel)

    if (isSubdir === '') return false
    else return isSubdir
  }

  /**
   * Retrieve basename from given path, respect to the current OS.
   */
  baseName(args: any) {
    return basename(args)
  }

  /**
   * Log message to log file.
   */
  log(args: any) {
    writeLog(args)
  }

  getAppConfigurations() {
    return appConfiguration()
  }

  async updateAppConfiguration(args: any) {
    await updateAppConfiguration(args)
  }

  /**
   * Start Jan API Server.
   */
  async startServer(args?: any) {
    const { startServer } = require('@janhq/server')
    return startServer({
      host: args?.host,
      port: args?.port,
      isCorsEnabled: args?.isCorsEnabled,
      isVerboseEnabled: args?.isVerboseEnabled,
      prefix: args?.prefix,
    })
  }

  /**
   * Stop Jan API Server.
   */
  stopServer() {
    const { stopServer } = require('@janhq/server')
    return stopServer()
  }
}
