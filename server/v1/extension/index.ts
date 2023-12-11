import {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginOptions,
} from "fastify";
import { join, extname } from "path";
import { ExtensionRoute } from "@janhq/core";

import { readdirSync } from "fs";

const node = require("@janhq/core/dist/node/index.cjs");

const router: FastifyPluginAsync = async (
  app: FastifyInstance,
  opts: FastifyPluginOptions
) => {
  // TODO: Share code between node projects
  app.post(`/${ExtensionRoute.getActiveExtensions}`, async (req, res) => {
    const activeExtensions = await node.getActiveExtensions();
    res.status(200).send(activeExtensions);
  });

  app.post(`/${ExtensionRoute.baseExtensions}`, async (req, res) => {
    const baseExtensionPath = join(__dirname, "..", "..", "..", "pre-install");
    const extensions = readdirSync(baseExtensionPath)
      .filter((file) => extname(file) === ".tgz")
      .map((file) => join(baseExtensionPath, file));

    res.status(200).send(extensions);
  });

  app.post(`/${ExtensionRoute.installExtension}`, async (req, res) => {
    const extensions = req.body as any;
    const installed = await node.installExtensions(JSON.parse(extensions)[0]);
    return JSON.parse(JSON.stringify(installed));
  });
};
export default router;
