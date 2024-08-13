import { join } from 'path'
import {
  getAppConfigurations,
  legacyDataPath,
} from './../utils/path'
import {
  readdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  lstatSync,
} from 'fs'
import { dump } from 'js-yaml'

export const getAllMessagesAndThreads =   async (_event: any): Promise<any> => {
    const janThreadFolderPath = join(legacyDataPath(), 'threads')
    // check if exist
    if (!existsSync(janThreadFolderPath)) {
      return {
        threads: [],
        messages: [],
      }
    }
    // get children of thread folder
    const allThreadFolders = readdirSync(janThreadFolderPath)
    const threads: any[] = []
    const messages: any[] = []
    for (const threadFolder of allThreadFolders) {
      try {
        const threadJsonFullPath = join(
          janThreadFolderPath,
          threadFolder,
          'thread.json'
        )
        const thread = JSON.parse(readFileSync(threadJsonFullPath, 'utf-8'))
        threads.push(thread)

        const messageFullPath = join(
          janThreadFolderPath,
          threadFolder,
          'messages.jsonl'
        )

        if (!existsSync(messageFullPath)) continue
        const lines = readFileSync(messageFullPath, 'utf-8')
          .toString()
          .split('\n')
          .filter((line: any) => line !== '')
        for (const line of lines) {
          messages.push(JSON.parse(line))
        }
      } catch (err) {
        console.error(err)
      }
    }
    return {
      threads,
      messages,
    }
  }

  export const getAllLocalModels = async (_event: any): Promise<boolean> => {
    const janModelsFolderPath = join(legacyDataPath(), 'models')

    if (!existsSync(janModelsFolderPath)) {
      console.debug('No local models found')
      return false
    }

    // get children of thread folder
    const allModelsFolders = readdirSync(janModelsFolderPath)
    let hasLocalModels = false
    for (const modelFolder of allModelsFolders) {
      try {
        const modelsFullPath = join(janModelsFolderPath, modelFolder)
        const dir = readdirSync(modelsFullPath)
        const ggufFile = dir.some((file) => file.endsWith('.gguf'))
        if (ggufFile) {
          hasLocalModels = true
          break
        }
      } catch (err) {
        console.error(err)
      }
    }
    return hasLocalModels
  }

  export const syncModelFileToCortex = async (_event: any): Promise<void> => {
     // Read models from legacy data folder
     const janModelFolderPath = join(legacyDataPath(), 'models')
     const allModelFolders = readdirSync(janModelFolderPath)
     console.log(`All model folders: ${allModelFolders}`)
    if(!allModelFolders?.length){
      console.log('No models found in the legacy data folder')
      return
    }
     // Latest app configs
     const configration = getAppConfigurations()
     const destinationFolderPath = join(configration.dataFolderPath, 'models')
 
     if (!existsSync(destinationFolderPath)) mkdirSync(destinationFolderPath)
 
     console.log(
       `Syncing model from ${allModelFolders} to ${destinationFolderPath}`
     )
     const reflect = require('@alumna/reflect')
 
     for (const modelName of allModelFolders) {
       const modelFolderPath = join(janModelFolderPath, modelName)
       // check if exist and is a directory
       if (!existsSync(modelFolderPath)) {
         console.debug(`Model folder ${modelFolderPath} does not exist`)
         continue
       }
 
       // check if it is a directory
       if (!lstatSync(modelFolderPath).isDirectory()) {
         console.debug(`${modelFolderPath} is not a directory`)
         continue
       }
 
       try {
         const filesInModelFolder = readdirSync(modelFolderPath)
         const destinationPath = join(destinationFolderPath, modelName)
 
         const modelJsonFullPath = join(
           janModelFolderPath,
           modelName,
           'model.json'
         )

         if (!existsSync(modelJsonFullPath)) {
           console.error(`Model json file not found in ${modelName}`)
           continue
         }
 
         const model = JSON.parse(readFileSync(modelJsonFullPath, 'utf-8'))
         const fileNames: string[] = model.sources.map((x: any) => x.filename)
         let files: string[] = []
 
         if (filesInModelFolder.length > 1) {
           // prepend fileNames with model folder path
           files = fileNames.map((x: string) =>
             join(destinationFolderPath, model.id, x)
           )
         } else if (
           model.sources.length &&
           !/^(http|https):\/\/[^/]+\/.*/.test(model.sources[0].url)
         ) {
           // Symlink case
           files = [model.sources[0].url]
         } else continue
 
         // create folder if not exist
         // only for local model files
         if (!existsSync(destinationPath) && filesInModelFolder.length > 1) {
           mkdirSync(destinationPath, { recursive: true })
         }
 
         const engine =
           model.engine === 'nitro' || model.engine === 'cortex'
             ? 'cortex.llamacpp'
             : (model.engine ?? 'cortex.llamacpp')
 
         const updatedModelFormat = {
           id: model.id,
           name: model.id,
           model: model.id,
           version: Number(model.version),
           files: files ?? [],
           created: Date.now(),
           object: 'model',
           owned_by: model.metadata?.author ?? '',
 
           // settings
           ngl: model.settings?.ngl,
           ctx_len: model.settings?.ctx_len ?? 2048,
           engine: engine,
           prompt_template: model.settings?.prompt_template ?? '',
 
           // parameters
           stop: model.parameters?.stop ?? [],
           top_p: model.parameters?.top_p,
           temperature: model.parameters?.temperature,
           frequency_penalty: model.parameters?.frequency_penalty,
           presence_penalty: model.parameters?.presence_penalty,
           max_tokens: model.parameters?.max_tokens ?? 2048,
           stream: model.parameters?.stream ?? true,
         }

         if (filesInModelFolder.length > 1) {
           const { err } = await reflect({
             src: modelFolderPath,
             dest: destinationPath,
             recursive: true,
             delete: false,
             overwrite: true,
             errorOnExist: false,
           })
 
           if (err) {
             console.error(err)
             continue
           }
         }
         // create the model.yml file
         const modelYamlData = dump(updatedModelFormat)
         const modelYamlPath = join(destinationFolderPath, `${modelName}.yaml`)
 
         writeFileSync(modelYamlPath, modelYamlData)
       } catch (err) {
         console.error(err)
       }
     }
  }