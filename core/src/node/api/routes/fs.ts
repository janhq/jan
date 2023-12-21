import { FileSystemRoute } from '../../../api'
import { join } from 'path'
import { HttpServer, userSpacePath } from '../../index'
const fs = require('fs')

export const fsRouter = async (app: HttpServer) => {
  // Generate handlers for each fs route
  Object.values(FileSystemRoute).forEach((route) => {
    app.post(`/${route}`, async (req, res) => {
      const body = JSON.parse(req.body as any)
      try {
        const result = await fs[route](
          ...body.map((arg: any) =>
            arg.includes('file:/') ? join(userSpacePath, arg.replace('file:/', '')) : arg,
          ),
        )
        res.status(200).send(result)
      } catch (ex) {
        console.log(ex)
      }
    })
  })
}
