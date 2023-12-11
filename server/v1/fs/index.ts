import {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginOptions,
} from "fastify";
import { FileSystemRoute } from "@janhq/core";
import { join } from "path";
const { userSpacePath } = require("@janhq/core/dist/node/index.cjs");
const fs = require("fs");

const router: FastifyPluginAsync = async (
  app: FastifyInstance,
  opts: FastifyPluginOptions
) => {
  // Generate handlers for each fs route
  Object.values(FileSystemRoute).forEach((route) => {
    app.post(`/${route}`, async (req, res) => {
      const body = JSON.parse(req.body as any);
      try {
        const result = await fs[route](
          ...body.map((arg: any) =>
            arg.includes("file:/")
              ? join(userSpacePath, arg.replace("file:/", ""))
              : arg
          )
        );
        res.status(200).send(result);
      } catch (ex) {
        console.log(ex);
      }
    });
  });
};
export default router;
