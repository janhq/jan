import {
  AppRoute,
  DownloadRoute,
  ExtensionRoute,
  FileManagerRoute,
  FileSystemRoute,
} from '../../../api'
import { Downloader } from '../processors/download'
import { FileSystem } from '../processors/fs'
import { Extension } from '../processors/extension'
import { FSExt } from '../processors/fsExt'
import { App } from '../processors/app'

export class RequestAdapter {
  downloader: Downloader
  fileSystem: FileSystem
  extension: Extension
  fsExt: FSExt
  app: App

  constructor(observer?: Function) {
    this.downloader = new Downloader(observer)
    this.fileSystem = new FileSystem()
    this.extension = new Extension()
    this.fsExt = new FSExt()
    this.app = new App()
  }

  // TODO: Clearer Factory pattern here
  process(route: string, ...args: any) {
    if (route in DownloadRoute) {
      return this.downloader.process(route, ...args)
    } else if (route in FileSystemRoute) {
      return this.fileSystem.process(route, ...args)
    } else if (route in ExtensionRoute) {
      return this.extension.process(route, ...args)
    } else if (route in FileManagerRoute) {
      return this.fsExt.process(route, ...args)
    } else if (route in AppRoute) {
      return this.app.process(route, ...args)
    }
  }
}
