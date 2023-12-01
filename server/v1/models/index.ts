import { Request, Response } from 'express'

import downloadModelController from './downloadModel'

function getModelController(req: Request, res: Response){
    
}

export default function route(req: Request, res: Response){
    switch(req.method){
        case 'get': 
            getModelController(req, res)
            break;
        case 'post':
            downloadModelController(req, res)
            break;
    }
}