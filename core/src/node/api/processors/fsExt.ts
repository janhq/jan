import { join } from 'path'
import fs from 'fs'
import { appResourcePath, normalizeFilePath, validatePath } from '../../helper/path'
import { defaultAppConfig, getJanDataFolderPath, getJanDataFolderPath as getPath } from '../../helper'
import { Processor } from './Processor'
import { FileStat } from '../../../types'

export class FSExt implements Processor {
  observer?: Function

  constructor(observer?: Function) {
    this.observer = observer
  }

  process(key: string, ...args: any): any {
    const instance = this as any
    const func = instance[key]
    return func(...args)
  }

  // Handles the 'getJanDataFolderPath' IPC event. This event is triggered to get the user space path.
  getJanDataFolderPath() {
    return Promise.resolve(getPath())
  }

  // Handles the 'getResourcePath' IPC event. This event is triggered to get the resource path.
  getResourcePath() {
    return appResourcePath()
  }

  // Handles the 'getUserHomePath' IPC event. This event is triggered to get the user app data path.
  // CAUTION: This would not return OS home path but the app data path.
  getUserHomePath() {
    return defaultAppConfig().data_folder
  }

  // handle fs is directory here
  fileStat(path: string, outsideJanDataFolder?: boolean) {
    const normalizedPath = normalizeFilePath(path)

    const fullPath = outsideJanDataFolder
      ? normalizedPath
      : join(getJanDataFolderPath(), normalizedPath)
    const isExist = fs.existsSync(fullPath)
    if (!isExist) return undefined

    const isDirectory = fs.lstatSync(fullPath).isDirectory()
    const size = fs.statSync(fullPath).size

    const fileStat: FileStat = {
      isDirectory,
      size,
    }

    return fileStat
  }

  writeBlob(path: string, data: any) {
    try {
      const normalizedPath = normalizeFilePath(path)
      
      const dataBuffer = Buffer.from(data, 'base64')
      const writePath = join(getJanDataFolderPath(), normalizedPath)
      validatePath(writePath)
      fs.writeFileSync(writePath, dataBuffer)
    } catch (err) {
      console.error(`writeFile ${path} result: ${err}`)
    }
  }

  copyFile(src: string, dest: string): Promise<void> {
    validatePath(dest)
    return new Promise((resolve, reject) => {
      fs.copyFile(src, dest, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }
}
