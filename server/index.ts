import fastify from "fastify";
import dotenv from "dotenv";
import { log, v1Router } from "@janhq/core/node";
import path from "path";

import os from "os";

// Load environment variables
dotenv.config();

// Define default settings
const JAN_API_HOST = process.env.JAN_API_HOST || "127.0.0.1";
const JAN_API_PORT = Number.parseInt(process.env.JAN_API_PORT || "1337");
const serverLogPath = path.join(os.homedir(), "jan", "logs", "server.log");

// Initialize server settings
let server: any | undefined = undefined;
let hostSetting: string = JAN_API_HOST;
let portSetting: number = JAN_API_PORT;
let corsEnbaled: boolean = true;
let isVerbose: boolean = true;

/**
 * Function to start the server
 * @param host - The host address for the server
 * @param port - The port number for the server
 * @param isCorsEnabled - Flag to enable or disable CORS
 * @param isVerboseEnabled - Flag to enable or disable verbose logging
 * @param schemaPath - Path to the OpenAPI schema file
 * @param baseDir - Base directory for the OpenAPI schema file
 */
export const startServer = async (
  host?: string,
  port?: number,
  isCorsEnabled?: boolean,
  isVerboseEnabled?: boolean,
  schemaPath?: string,
  baseDir?: string
) => {
  // Update server settings
  isVerbose = isVerboseEnabled ?? true;
  hostSetting = host ?? JAN_API_HOST;
  portSetting = port ?? JAN_API_PORT;
  corsEnbaled = isCorsEnabled ?? true;

  // Start the server
  try {
    // Log server start
    if (isVerbose)
      log(`[API]::Debug: Starting JAN API server...`, "server.log");

    // Initialize Fastify server with logging
    server = fastify({
      logger: {
        level: "info",
        file: serverLogPath,
      },
    });

    // Register CORS if enabled
    if (corsEnbaled) await server.register(require("@fastify/cors"), {});

    // Register Swagger for API documentation
    await server.register(require("@fastify/swagger"), {
      mode: "static",
      specification: {
        path: schemaPath ?? "./../docs/openapi/jan.yaml",
        baseDir: baseDir ?? "./../docs/openapi",
      },
    });

    // Register Swagger UI
    await server.register(require("@fastify/swagger-ui"), {
      routePrefix: "/",
      baseDir: baseDir ?? path.join(__dirname, "../..", "./docs/openapi"),
      uiConfig: {
        docExpansion: "full",
        deepLinking: false,
      },
      staticCSP: false,
      transformSpecificationClone: true,
    });

    // Register static file serving for extensions
    // TODO: Watch extension files changes and reload
    await server.register(
      (childContext: any, _: any, done: any) => {
        childContext.register(require("@fastify/static"), {
          root:
            process.env.EXTENSION_ROOT ||
            path.join(require("os").homedir(), "jan", "extensions"),
          wildcard: false,
        });

        done();
      },
      { prefix: "extensions" }
    );

    // Register API routes
    await server.register(v1Router, { prefix: "/v1" });

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
            `[API]::Debug: JAN API listening at: http://${JAN_API_HOST}:${JAN_API_PORT}`
          );
      });
  } catch (e) {
    // Log any errors
    if (isVerbose) log(`[API]::Error: ${e}`);
  }
};

/**
 * Function to stop the server
 */
export const stopServer = async () => {
  try {
    // Log server stop
    if (isVerbose) log(`[API]::Debug: Server stopped`, "server.log");
    // Stop the server
    await server.close();
  } catch (e) {
    // Log any errors
    if (isVerbose) log(`[API]::Error: ${e}`);
  }
};
