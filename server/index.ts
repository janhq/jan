import fastify from 'fastify'
import dotenv from 'dotenv'
import {
  getServerLogPath,
  v1Router,
  logServer,
  getJanExtensionsPath,
} from '@janhq/core/node'
import { join } from 'path'
import tcpPortUsed from 'tcp-port-used'

// Load environment variables
dotenv.config()

// Define default settings
const JAN_API_HOST = process.env.JAN_API_HOST || '127.0.0.1'
const JAN_API_PORT = Number.parseInt(process.env.JAN_API_PORT || '1337')

// Initialize server settings
let server: any | undefined = undefined
let hostSetting: string = JAN_API_HOST
let portSetting: number = JAN_API_PORT
let corsEnabled: boolean = true
let isVerbose: boolean = true

/**
 * Server configurations
 * @param host - The host address for the server
 * @param port - The port number for the server
 * @param isCorsEnabled - Flag to enable or disable CORS
 * @param isVerboseEnabled - Flag to enable or disable verbose logging
 * @param schemaPath - Path to the OpenAPI schema file
 * @param baseDir - Base directory for the OpenAPI schema file
 */
export interface ServerConfig {
  host?: string
  port?: number
  isCorsEnabled?: boolean
  isVerboseEnabled?: boolean
  schemaPath?: string
  baseDir?: string
  storageAdataper?: any
}

/**
 * Function to start the server
 * @param configs - Server configurations
 */
export const startServer = async (configs?: ServerConfig): Promise<boolean> => {
  if (configs?.port && configs?.host) {
    const inUse = await tcpPortUsed.check(Number(configs.port), configs.host)
    if (inUse) {
      const errorMessage = `Port ${configs.port} is already in use.`
      logServer(errorMessage)
      throw new Error(errorMessage)
    }
  }

  // Update server settings
  isVerbose = configs?.isVerboseEnabled ?? true
  hostSetting = configs?.host ?? JAN_API_HOST
  portSetting = configs?.port ?? JAN_API_PORT
  corsEnabled = configs?.isCorsEnabled ?? true
  const serverLogPath = getServerLogPath()

  // Start the server
  try {
    // Log server start
    if (isVerbose) logServer(`Debug: Starting JAN API server...`)

    // Initialize Fastify server with logging
    server = fastify({
      logger: {
        level: 'info',
        file: serverLogPath,
      },
    })

    // Register CORS if enabled
    if (corsEnabled) await server.register(require('@fastify/cors'), {})

    // Register Swagger for API documentation
    await server.register(require('@fastify/swagger'), {
      mode: 'static',
      specification: {
        path: configs?.schemaPath ?? './../docs/openapi/jan.yaml',
        baseDir: configs?.baseDir ?? './../docs/openapi',
      },
    })

    // Register Swagger UI
    await server.register(require('@fastify/swagger-ui'), {
      routePrefix: '/',
      baseDir: configs?.baseDir ?? join(__dirname, '../..', './docs/openapi'),
      uiConfig: {
        docExpansion: 'full',
        deepLinking: false,
      },
      staticCSP: false,
      transformSpecificationClone: true,
    })

    // Register static file serving for extensions
    // TODO: Watch extension files changes and reload
    await server.register(
      (childContext: any, _: any, done: any) => {
        childContext.register(require('@fastify/static'), {
          root: getJanExtensionsPath(),
          wildcard: false,
        })

        done()
      },
      { prefix: 'extensions' }
    )

    // Register proxy middleware
    if (configs?.storageAdataper)
      server.addHook('preHandler', configs.storageAdataper)

    // Register API routes
    await server.register(v1Router, { prefix: '/v1' })
    // Start listening for requests
    await server
      .listen({
        port: portSetting,
        host: hostSetting,
      })
      .then(() => {
        // Log server listening
        if (isVerbose)
          logServer(
            `Debug: JAN API listening at: http://${hostSetting}:${portSetting}`
          )
      })
    return true
  } catch (e) {
    // Log any errors
    if (isVerbose) logServer(`Error: ${e}`)
  }
  return false
}

/**
 * Function to stop the server
 */
export const stopServer = async () => {
  try {
    // Log server stop
    if (isVerbose) logServer(`Debug: Server stopped`)
    // Stop the server
    await server.close()
  } catch (e) {
    // Log any errors
    if (isVerbose) logServer(`Error: ${e}`)
  }
}
