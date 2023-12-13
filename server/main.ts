import fastify from 'fastify'
import dotenv from 'dotenv'
import v1API from './v1'
const server = fastify()

dotenv.config()
server.register(v1API, {prefix: "/api/v1"})


const JAN_API_PORT = Number.parseInt(process.env.JAN_API_PORT || '1337')
const JAN_API_HOST = process.env.JAN_API_HOST || "0.0.0.0"

server.listen({
  port: JAN_API_PORT, 
  host: JAN_API_HOST
}).then(() => {
  console.log(`JAN API listening at: http://${JAN_API_HOST}:${JAN_API_PORT}`);
})

