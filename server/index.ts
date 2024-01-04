import fastify from "fastify";
import dotenv from "dotenv";
import { log, v1Router } from "@janhq/core/node";
import path from "path";

import os from "os";

dotenv.config();

const JAN_API_HOST = process.env.JAN_API_HOST || "127.0.0.1";
const JAN_API_PORT = Number.parseInt(process.env.JAN_API_PORT || "1337");
const serverLogPath = path.join(os.homedir(), "jan", "server.log");

let server: any | undefined = undefined;

export const startServer = async (schemaPath?: string, baseDir?: string) => {
  try {
    server = fastify({
      logger: {
        level: "info",
        file: serverLogPath,
      },
    });
    await server.register(require("@fastify/cors"), {});

    await server.register(require("@fastify/swagger"), {
      mode: "static",
      specification: {
        path: schemaPath ?? "./../docs/openapi/jan.yaml",
        baseDir: baseDir ?? "./../docs/openapi",
      },
    });

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
    await server.register(v1Router, { prefix: "/v1" });
    await server
      .listen({
        port: JAN_API_PORT,
        host: JAN_API_HOST,
      })
      .then(() => {
        log(`JAN API listening at: http://${JAN_API_HOST}:${JAN_API_PORT}`);
      });
  } catch (e) {
    log(e);
  }
};

export const stopServer = async () => {
  try {
    await server.close();
  } catch (e) {
    log(e);
  }
};
