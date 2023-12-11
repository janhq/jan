import fsAPI from "./fs";
import extAPI from "./extension"

import { FastifyInstance, FastifyPluginAsync } from "fastify";

const router: FastifyPluginAsync = async (app: FastifyInstance, opts) => {
  app.register(fsAPI, {
    prefix: "/fs",
  });
  app.register(extAPI, {
    prefix: "/extension",
  });
};
export default router;
