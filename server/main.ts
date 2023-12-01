import fastify from 'fastify'

import v1API from './v1'
const JAN_API_PORT = 1337;
const server = fastify()

const USER_ROOT_DIR = '.data'
server.register(v1API, {prefix: "/api/v1"})


server.listen({
  port: JAN_API_PORT, 
  host: "0.0.0.0"
}).then(()=>{
  console.log(`JAN API listening at: http://0.0.0.0:${JAN_API_PORT}`);
})

