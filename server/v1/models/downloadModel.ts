import { RouteHandlerMethod, FastifyRequest, FastifyReply } from "fastify";

const controller: RouteHandlerMethod = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  res.status(200).send({
    status: "Ok",
  });
};

export default controller;
