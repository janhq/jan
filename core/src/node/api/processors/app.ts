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
   * @param from - The path to check.
   * @param to - The directory to check against.
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
}
