import { join } from 'path'
import { normalizeFilePath } from '../../helper/path'
import { getJanDataFolderPath } from '../../helper'
import { Processor } from './Processor'
import fs from 'fs'

export class FileSystem implements Processor {
  observer?: Function
  private static moduleName = 'fs'

  constructor(observer?: Function) {
    this.observer = observer
  }

  process(route: string, ...args: any): any {
    const instance = this as any
    const func = instance[route]

    if (func) {
      return func(...args)
    } else {
      return import(FileSystem.moduleName).then((mdl) =>
        mdl[route](
          ...args.map((arg: any) => {
            return typeof arg === 'string' &&
              (arg.startsWith(`file:/`) || arg.startsWith(`file:\\`))
              ? join(getJanDataFolderPath(), normalizeFilePath(arg))
              : arg
          })
        )
      )
    }
  }

  rm(...args: any): Promise<void> {
    if (typeof args[0] !== 'string') {
      throw new Error(`rm error: Invalid argument ${JSON.stringify(args)}`)
    }

    let path = args[0]
    if (path.startsWith(`file:/`) || path.startsWith(`file:\\`)) {
      path = join(getJanDataFolderPath(), normalizeFilePath(path))
    }

    return new Promise((resolve, reject) => {
      fs.rm(path, { recursive: true, force: true }, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  mkdir(...args: any): Promise<void> {
    if (typeof args[0] !== 'string') {
      throw new Error(`mkdir error: Invalid argument ${JSON.stringify(args)}`)
    }

    let path = args[0]
    if (path.startsWith(`file:/`) || path.startsWith(`file:\\`)) {
      path = join(getJanDataFolderPath(), normalizeFilePath(path))
    }

    return new Promise((resolve, reject) => {
      fs.mkdir(path, { recursive: true }, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }
}
