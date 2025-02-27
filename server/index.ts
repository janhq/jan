import fastify from 'fastify'
import dotenv from 'dotenv'
import { log } from '@janhq/core/node'
import tcpPortUsed from 'tcp-port-used'
import { Logger } from './helpers/logger'
import CORTEX_SCHEMA from './cortex.json'

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
  prefix?: string
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
      log(errorMessage, '[SERVER]')
      throw new Error(errorMessage)
    }
  }

  // Update server settings
  isVerbose = configs?.isVerboseEnabled ?? true
  hostSetting = configs?.host ?? JAN_API_HOST
  portSetting = configs?.port ?? JAN_API_PORT
  corsEnabled = configs?.isCorsEnabled ?? true

  // Start the server
  try {
    // Log server start
    if (isVerbose) log(`Debug: Starting JAN API server...`, '[SERVER]')

    // Initialize Fastify server with logging
    server = fastify({
      loggerInstance: new Logger(),
      // Set body limit to 100MB - Default is 1MB
      // According to OpenAI - a batch input file can be up to 100 MB in size
      // Whisper endpoints accept up to 25MB
      // Vision endpoints accept up to 4MB
      bodyLimit: 104_857_600,
    })

    // Register CORS if enabled
    if (corsEnabled) await server.register(require('@fastify/cors'), {})

    CORTEX_SCHEMA.servers[0].url = configs?.prefix ?? '/v1'
    // Register Swagger for API documentation
    await server.register(require('@fastify/swagger'), {
      mode: 'static',
      specification: {
        document: CORTEX_SCHEMA,
      },
    })

    // Register Swagger UI
    await server.register(require('@fastify/swagger-ui'), {
      routePrefix: '/',
      uiConfig: {
        docExpansion: 'full',
        deepLinking: false,
      },
      staticCSP: false,
      transformSpecificationClone: true,
    })

    const proxy = require('@fastify/http-proxy')
    server.register(proxy, {
      upstream: `${CORTEX_API_URL}/v1`,
      prefix: configs?.prefix ?? '/v1',
      http2: false,
    })

    server.register(proxy, {
      upstream: `${CORTEX_API_URL}/system`,
      prefix:'/system',
      http2: false,
    })

    server.register(proxy, {
      upstream: `${CORTEX_API_URL}/processManager`,
      prefix:'/processManager',
      http2: false,
    })

    server.register(proxy, {
      upstream: `${CORTEX_API_URL}/healthz`,
      prefix:'/healthz',
      http2: false,
    })

    // Start listening for requests
    await server
      .listen({
        port: portSetting,
        host: hostSetting,
      })
      .then(() => {
        // Log server listening
        if (isVerbose)
          log(
            `Debug: JAN API listening at: http://${hostSetting}:${portSetting}`,
            '[SERVER]'
          )
      })
    return true
  } catch (e) {
    // Log any errors
    if (isVerbose) log(`Error: ${e}`, '[SERVER]')
  }
  return false
}

/**
 * Function to stop the server
 */
export const stopServer = async () => {
  try {
    // Log server stop
    if (isVerbose) log(`Debug: Server stopped`, '[SERVER]')
    // Stop the server
    await server?.close()
  } catch (e) {
    // Log any errors
    if (isVerbose) log(`Error: ${e}`, '[SERVER]')
  }
}
