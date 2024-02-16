import { join } from 'path'
import { normalizeFilePath } from '../../helper/path'
import { getJanDataFolderPath } from '../../helper'
import { Processor } from './Processor'

export class FileSystem implements Processor {
  observer?: Function
  private static moduleName = 'fs'

  constructor(observer?: Function) {
    this.observer = observer
  }

  process(route: string, ...args: any[]): any {
    return import(FileSystem.moduleName).then((mdl) =>
      mdl[route](
        ...args.map((arg: any) =>
          typeof arg === 'string' && (arg.startsWith(`file:/`) || arg.startsWith(`file:\\`))
            ? join(getJanDataFolderPath(), normalizeFilePath(arg))
            : arg
        )
      )
    )
  }
}
