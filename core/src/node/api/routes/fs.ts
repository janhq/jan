import { FileManagerRoute, FileSystemRoute } from '../../../api'
import { join } from 'path'
import { HttpServer } from '../HttpServer'
import { getJanDataFolderPath } from '../../utils'
import { normalizeFilePath } from '../../path'
import { writeFileSync } from 'fs'

export const fsRouter = async (app: HttpServer) => {
  const moduleName = 'fs'
  // Generate handlers for each fs route
  Object.values(FileSystemRoute).forEach((route) => {
    app.post(`/${route}`, async (req, res) => {
      const body = JSON.parse(req.body as any)
      try {
        const result = await import(moduleName).then((mdl) => {
          return mdl[route](
            ...body.map((arg: any) =>
              typeof arg === 'string' && (arg.startsWith(`file:/`) || arg.startsWith(`file:\\`))
                ? join(getJanDataFolderPath(), normalizeFilePath(arg))
                : arg
            )
          )
        })
        res.status(200).send(result)
      } catch (ex) {
        console.log(ex)
      }
    })
  })
  app.post(`/${FileManagerRoute.writeBlob}`, async (request: any, reply: any) => {
    try {
      const args = JSON.parse(request.body) as any[]
      console.log('writeBlob:', args[0])
      const dataBuffer = Buffer.from(args[1], 'base64')
      writeFileSync(args[0], dataBuffer)
    } catch (err) {
      console.error(`writeFile ${request.body} result: ${err}`)
    }
  })
}
