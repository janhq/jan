import { join, extname } from 'path'
import { ExtensionRoute } from '../../../api/index'
import { ModuleManager } from '../../module'
import { getActiveExtensions, installExtensions } from '../../extension/store'
import { HttpServer } from '../HttpServer'

import { readdirSync } from 'fs'
import { getJanExtensionsPath } from '../../utils'

export const extensionRouter = async (app: HttpServer) => {
  // TODO: Share code between node projects
  app.post(`/${ExtensionRoute.getActiveExtensions}`, async (_req, res) => {
    const activeExtensions = await getActiveExtensions()
    res.status(200).send(activeExtensions)
  })

  app.post(`/${ExtensionRoute.baseExtensions}`, async (_req, res) => {
    const baseExtensionPath = join(__dirname, '..', '..', '..', 'pre-install')
    const extensions = readdirSync(baseExtensionPath)
      .filter((file) => extname(file) === '.tgz')
      .map((file) => join(baseExtensionPath, file))

    res.status(200).send(extensions)
  })

  app.post(`/${ExtensionRoute.installExtension}`, async (req) => {
    const extensions = req.body as any
    const installed = await installExtensions(JSON.parse(extensions)[0])
    return JSON.parse(JSON.stringify(installed))
  })

  app.post(`/${ExtensionRoute.invokeExtensionFunc}`, async (req, res) => {
    const args = JSON.parse(req.body as any)
    console.debug(args)
    const module = await import(join(getJanExtensionsPath(), args[0]))

    ModuleManager.instance.setModule(args[0], module)
    const method = args[1]
    if (typeof module[method] === 'function') {
      // remove first item from args
      const newArgs = args.slice(2)
      console.log(newArgs)
      return module[method](...args.slice(2))
    } else {
      console.debug(module[method])
      console.error(`Function "${method}" does not exist in the module.`)
    }
  })
}
