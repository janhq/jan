import { setupMenu } from './utils/menu'
import app from 'express'
import bodyParser from 'body-parser'
import fs from 'fs'
/**
 * Managers
 **/
import { ModuleManager } from './managers/module'
import { PluginManager } from './managers/plugin'


const server = app()
server.use(bodyParser)

const USER_ROOT_DIR = '.data'
server.post("fs", (req, res) => {
  let op = req.body.op;
  switch(op){
    case 'readFile':
      fs.readFile(req.body.path, ()=>{})
    case 'writeFile':
      fs.writeFile(req.body.path, Buffer.from(req.body.data, "base64"), ()=>{})
  }
})

server.listen(1337, ()=>{
  PluginManager.instance.migratePlugins()
  PluginManager.instance.setupPlugins()
  setupMenu()
})

