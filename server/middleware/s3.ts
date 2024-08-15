import { join } from 'path'

// Middleware to intercept requests and proxy if certain conditions are met
const config = {
  endpoint: process.env.AWS_ENDPOINT,
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
}

const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME

const fs = require('@cyclic.sh/s3fs')(S3_BUCKET_NAME, config)
const PROXY_PREFIX = '/v1/fs'
const PROXY_ROUTES = ['/threads', '/messages']

export const s3 = (req: any, reply: any, done: any) => {
  // Proxy FS requests to S3 using S3FS
  if (req.url.startsWith(PROXY_PREFIX)) {
    const route = req.url.split('/').pop()
    const args = parseRequestArgs(req)

    // Proxy matched requests to the s3fs module
    if (args.length && PROXY_ROUTES.some((route) => args[0].includes(route))) {
      try {
        // Handle customized route
        // S3FS does not handle appendFileSync
        if (route === 'appendFileSync') {
          let result = handAppendFileSync(args)

          reply.status(200).send(result)
          return
        }
        // Reroute the other requests to the s3fs module
        const result = fs[route](...args)
        reply.status(200).send(result)
        return
      } catch (ex) {
        console.error(ex)
      }
    }
  }
  // Let other requests go through
  done()
}

const parseRequestArgs = (req: Request) => {
  const {
    getJanDataFolderPath,
    normalizeFilePath,
  } = require('@janhq/core/node')

  return JSON.parse(req.body as any).map((arg: any) =>
    typeof arg === 'string' &&
    (arg.startsWith(`file:/`) || arg.startsWith(`file:\\`))
      ? join(getJanDataFolderPath(), normalizeFilePath(arg))
      : arg
  )
}

const handAppendFileSync = (args: any[]) => {
  if (fs.existsSync(args[0])) {
    const data = fs.readFileSync(args[0], 'utf-8')
    return fs.writeFileSync(args[0], data + args[1])
  } else {
    return fs.writeFileSync(args[0], args[1])
  }
}
