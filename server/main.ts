import express from 'express'
import bodyParser from 'body-parser'
import fs from 'fs'
import v1API from './v1'

const JAN_API_PORT = 1337;

const server = express()
server.use(bodyParser.urlencoded())
server.use(bodyParser.json())

const USER_ROOT_DIR = '.data'
server.use("/v1", v1API)

// server.post("fs", (req, res) => {
//   let op = req.body.op;
//   switch(op){
//     case 'readFile':
//       fs.readFile(req.body.path, ()=>{})
//     case 'writeFile':
//       fs.writeFile(req.body.path, Buffer.from(req.body.data, "base64"), ()=>{})
//   }
// })

server.listen(JAN_API_PORT, () => {
  console.log(`JAN API listening at: http://localhost:${JAN_API_PORT}`);
})

