import { executeSerial } from "../electron/core/plugin-manager/execution/extension-manager";
import { DataService,
    ModelService,
    InfereceService,
    ModelManagementService,
    SystemMonitoringService,
    PreferenceService} from "./shared/coreService";
import { Product } from "@/_models/Product";

const api_base_path = "http://localhost:4000/api/v1/execute-func"

export const appVersion = (): Promise<string | undefined> => {
    if (isRunWithElectron()) {
        return  window.electronAPI.appVersion();
    }
    return Promise.resolve(process.env.npm_package_version);
  };

  export const resourcesInfo =  () => {
        if(isRunWithElectron()){
            return executeSerial(
                SystemMonitoringService.GET_RESOURCES_INFORMATION
              );
        }
        return fetchApi(SystemMonitoringService.GET_RESOURCES_INFORMATION, null);
  };

  export const currentLoad = () => {
    if(isRunWithElectron()){
        return executeSerial(
            SystemMonitoringService.GET_CURRENT_LOAD_INFORMATION
          );
    }
    return fetchApi(SystemMonitoringService.GET_CURRENT_LOAD_INFORMATION, null);
}

export async function getConversations(): Promise<Product[]> {
    if(isRunWithElectron()){
        return await executeSerial(DataService.GET_CONVERSATIONS);
    }
    return fetchApi(DataService.GET_CONVERSATIONS, null);
  }

export async function getFinishedDownloadModels(): Promise<Product[]> {
    if(isRunWithElectron()){
        const downloadedModels: Product[] = await executeSerial(
        DataService.GET_FINISHED_DOWNLOAD_MODELS
        );
        return downloadedModels ?? [];
    }
    return fetchApi(DataService.GET_FINISHED_DOWNLOAD_MODELS, null);
  }


function isRunWithElectron(){
    return window.electronAPI != null;
}



async function fetchApi(name: string, intput: any): Promise<any>{
    const response = await fetch(api_base_path, {
      method: 'POST',
      body: JSON.stringify({"name": name, "input": intput}),
      headers: {'Content-Type': 'application/json', 'Authorization': ''} 
    });
    
    if (!response.ok) 
    { 
        console.error("Error");
        return null;
    }
    else if (response.status >= 400) {
        console.error('HTTP Error: '+response.status+' - '+response.text);
        return null;
    }
    else{
        return response.json();
    }
}