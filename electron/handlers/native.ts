import { app, ipcMain, dialog, shell, nativeTheme } from 'electron'
import { windowManager } from '../managers/window'
import {
  AppEvent,
  NativeRoute,
  SelectFileProp,
  SelectFileOption,
} from '@janhq/core/node'
import { menu } from '../utils/menu'
import { join } from 'path'
import { getAppConfigurations, getJanDataFolderPath } from './../utils/path'
import {
  readdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'fs'
import { dump } from 'js-yaml'

const isMac = process.platform === 'darwin'

export function handleAppIPCs() {
  /**
   * Handles the "setNativeThemeLight" IPC message by setting the native theme source to "light".
   * This will change the appearance of the app to the light theme.
   */
  ipcMain.handle(NativeRoute.setNativeThemeLight, () => {
    nativeTheme.themeSource = 'light'
  })

  ipcMain.handle(NativeRoute.setCloseApp, () => {
    windowManager.mainWindow?.close()
  })

  ipcMain.handle(NativeRoute.setMinimizeApp, () => {
    windowManager.mainWindow?.minimize()
  })

  ipcMain.handle(NativeRoute.homePath, () => {
    // Handles the 'get jan home path' IPC event. This event is triggered to get the default jan home path.
    return join(
      process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME'] ?? '',
      'jan'
    )
  })
  ipcMain.handle(NativeRoute.setMaximizeApp, async (_event) => {
    if (windowManager.mainWindow?.isMaximized()) {
      windowManager.mainWindow.unmaximize()
    } else {
      windowManager.mainWindow?.maximize()
    }
  })

  ipcMain.handle(NativeRoute.getThemes, async () => {
    const folderPath = join(getJanDataFolderPath(), 'themes')
    const installedThemes = readdirSync(folderPath)

    const themesOptions = Promise.all(
      installedThemes
        .filter((x: string) => x !== '.DS_Store')
        .map(async (x: string) => {
          const y = join(folderPath, x, `theme.json`)
          const c = JSON.parse(readFileSync(y, 'utf-8'))
          return { name: c?.displayName, value: c.id }
        })
    )
    return themesOptions
  })

  ipcMain.handle(NativeRoute.readTheme, async (_event, themeId: string) => {
    const folderPath = join(getJanDataFolderPath(), 'themes')
    const filePath = join(folderPath, themeId, `theme.json`)
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  })

  /**
   * Handles the "setNativeThemeDark" IPC message by setting the native theme source to "dark".
   * This will change the appearance of the app to the dark theme.
   */
  ipcMain.handle(NativeRoute.setNativeThemeDark, () => {
    nativeTheme.themeSource = 'dark'
  })

  /**
   * Opens a URL in the user's default browser.
   * @param _event - The IPC event object.
   * @param url - The URL to open.
   */
  ipcMain.handle(NativeRoute.openExternalUrl, async (_event, url) => {
    shell.openExternal(url)
  })

  /**
   * Opens a URL in the user's default browser.
   * @param _event - The IPC event object.
   * @param url - The URL to open.
   */
  ipcMain.handle(NativeRoute.openFileExplore, async (_event, url) => {
    shell.openPath(url)
  })

  /**
   * Relaunches the app in production - reload window in development.
   * @param _event - The IPC event object.
   * @param url - The URL to reload.
   */
  ipcMain.handle(NativeRoute.relaunch, async (_event) => {
    app.relaunch()
    app.exit()
  })

  ipcMain.handle(NativeRoute.selectDirectory, async () => {
    const mainWindow = windowManager.mainWindow
    if (!mainWindow) {
      console.error('No main window found')
      return
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a folder',
      buttonLabel: 'Select Folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (canceled) {
      return
    } else {
      return filePaths[0]
    }
  })

  ipcMain.handle(
    NativeRoute.selectFiles,
    async (_event, option?: SelectFileOption) => {
      const mainWindow = windowManager.mainWindow
      if (!mainWindow) {
        console.error('No main window found')
        return
      }

      const title = option?.title ?? 'Select files'
      const buttonLabel = option?.buttonLabel ?? 'Select'
      const props: SelectFileProp[] = ['openFile']

      if (option?.allowMultiple) {
        props.push('multiSelections')
      }

      if (option?.selectDirectory) {
        props.push('openDirectory')
      }
      console.debug(`Select files with props: ${props}`)
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title,
        buttonLabel,
        properties: props,
        filters: option?.filters,
      })

      if (canceled) return

      return filePaths
    }
  )

  ipcMain.handle(
    NativeRoute.hideQuickAskWindow,
    async (): Promise<void> => windowManager.hideQuickAskWindow()
  )

  ipcMain.handle(
    NativeRoute.sendQuickAskInput,
    async (_event, input: string): Promise<void> => {
      windowManager.mainWindow?.webContents.send(
        AppEvent.onUserSubmitQuickAsk,
        input
      )
    }
  )

  ipcMain.handle(NativeRoute.showOpenMenu, function (_e, args) {
    if (!isMac && windowManager.mainWindow) {
      menu.popup({
        window: windowManager.mainWindow,
        x: args.x,
        y: args.y,
      })
    }
  })

  ipcMain.handle(
    NativeRoute.hideMainWindow,
    async (): Promise<void> => windowManager.hideMainWindow()
  )

  ipcMain.handle(
    NativeRoute.showMainWindow,
    async (): Promise<void> => windowManager.showMainWindow()
  )

  ipcMain.handle(
    NativeRoute.quickAskSizeUpdated,
    async (_event, heightOffset: number): Promise<void> =>
      windowManager.expandQuickAskWindow(heightOffset)
  )

  ipcMain.handle(NativeRoute.ackDeepLink, async (_event): Promise<void> => {
    windowManager.ackDeepLink()
  })

  ipcMain.handle(NativeRoute.openAppLog, async (_event): Promise<void> => {
    const configuration = getAppConfigurations()
    const dataFolder = configuration.data_folder

    try {
      const errorMessage = await shell.openPath(join(dataFolder))
      if (errorMessage) {
        console.error(`An error occurred: ${errorMessage}`)
      } else {
        console.log('Path opened successfully')
      }
    } catch (error) {
      console.error(`Failed to open path: ${error}`)
    }
  })

  ipcMain.handle(NativeRoute.syncModelFileToCortex, async (_event) => {
    const janModelFolderPath = join(getJanDataFolderPath(), 'models')
    const allModelFolders = readdirSync(janModelFolderPath)

    const configration = getAppConfigurations()
    const destinationFolderPath = join(configration.data_folder, 'models')

    if (!existsSync(destinationFolderPath)) mkdirSync(destinationFolderPath)
    console.log('destinationFolderPath', destinationFolderPath)
    const reflect = require('@alumna/reflect')

    for (const modelName of allModelFolders) {
      const modelFolderPath = join(janModelFolderPath, modelName)
      try {
        const filesInModelFolder = readdirSync(modelFolderPath)

        const destinationPath = join(destinationFolderPath, modelName)

        const modelJsonFullPath = join(
          janModelFolderPath,
          modelName,
          'model.json'
        )

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
            exclude: ['model.json'],
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
  })

  ipcMain.handle(
    NativeRoute.getAllMessagesAndThreads,
    async (_event): Promise<any> => {
      const janThreadFolderPath = join(getJanDataFolderPath(), 'threads')
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
  )

  ipcMain.handle(
    NativeRoute.getAllLocalModels,
    async (_event): Promise<boolean> => {
      const janModelsFolderPath = join(getJanDataFolderPath(), 'models')

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
  )
}
