import express, { Express, Request, Response } from 'express'
import cors from "cors";
import { getResourcesInfo, getCurrentLoad} from "../electron/core/plugins/monitoring-plugin/module"
import { DataService,
    ModelService,
    InfereceService,
    ModelManagementService,
    SystemMonitoringService,
    PreferenceService} from "../web/shared/coreService"
const { getConversations, getFinishedDownloadModels } =  require("../electron/core/plugins/data-plugin/module")

const allowedOrigins = ['http://localhost:3000'];
const options: cors.CorsOptions = {
  origin: allowedOrigins
};
const app: Express = express()
app.use(cors(options))
app.use(express.json());


const port: number = 4000

app.post('/api/v1/execute-func', (req: Request, res: Response) => {
    executeFunc(req.body["name"], req.body["input"])
    .then((result:any)=>{
        res.json(result)
    })
});

app.listen(port, () => console.log(`Application is running on port ${port}`));


const executeFunc = (name: string, input: any): Promise<any> => {
    switch(name){
        // monitoring plugin
        case SystemMonitoringService.GET_CURRENT_LOAD_INFORMATION:
            return getCurrentLoad();
        case SystemMonitoringService.GET_RESOURCES_INFORMATION:
            return getResourcesInfo();
        // data plugin
        case DataService.GET_CONVERSATIONS:
            return getConversations();
        case DataService.GET_FINISHED_DOWNLOAD_MODELS:
            return getFinishedDownloadModels();
        case DataService.CREATE_CONVERSATION:  
        case DataService.CREATE_MESSAGE:
        case DataService.DELETE_CONVERSATION:
        case DataService.DELETE_DOWNLOAD_MODEL:
        case DataService.GET_CONVERSATION_MESSAGES:
        case DataService.GET_MODEL_BY_ID:
        case DataService.GET_UNFINISHED_DOWNLOAD_MODELS:
        case DataService.STORE_MODEL:
        case DataService.UPDATE_FINISHED_DOWNLOAD:
        case DataService.UPDATE_MESSAGE:
            break;
    }
    return Promise.resolve();
}