import { Request, Response } from 'express'

import assistantsAPI from './assistants'
import chatCompletionAPI from './chat'
import modelsAPI from './models'
import threadsAPI from './threads'

export default function route(req: Request, res: Response){
    console.log(req.path.split("/")[1])
    switch (req.path.split("/")[1]){
        case 'assistants':
            assistantsAPI(req, res)
        case 'chat':
            chatCompletionAPI(req, res)
        case 'models':
            modelsAPI(req, res)
        case 'threads':
            threadsAPI(req, res)
    }
}