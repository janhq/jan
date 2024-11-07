import {
  fs,
  Assistant,
  events,
  joinPath,
  AssistantExtension,
  AssistantEvent,
  ToolManager,
} from '@janhq/core'
import { RetrievalTool } from './tools/retrieval'

export default class JanAssistantExtension extends AssistantExtension {
  private static readonly _homeDir = 'file://assistants'

  async onLoad() {
    // Register the retrieval tool
    ToolManager.instance().register(new RetrievalTool())

    // making the assistant directory
    const assistantDirExist = await fs.existsSync(
      JanAssistantExtension._homeDir
    )
    if (
      localStorage.getItem(`${this.name}-version`) !== VERSION ||
      !assistantDirExist
    ) {
      if (!assistantDirExist) await fs.mkdir(JanAssistantExtension._homeDir)

      // Write assistant metadata
      await this.createJanAssistant()
      // Finished migration
      localStorage.setItem(`${this.name}-version`, VERSION)
      // Update the assistant list
      events.emit(AssistantEvent.OnAssistantsUpdate, {})
    }
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {}

  async createAssistant(assistant: Assistant): Promise<void> {
    const assistantDir = await joinPath([
      JanAssistantExtension._homeDir,
      assistant.id,
    ])
    if (!(await fs.existsSync(assistantDir))) await fs.mkdir(assistantDir)

    // store the assistant metadata json
    const assistantMetadataPath = await joinPath([
      assistantDir,
      'assistant.json',
    ])
    try {
      await fs.writeFileSync(
        assistantMetadataPath,
        JSON.stringify(assistant, null, 2)
      )
    } catch (err) {
      console.error(err)
    }
  }

  async getAssistants(): Promise<Assistant[]> {
    try {
      // get all the assistant directories
      // get all the assistant metadata json
      const results: Assistant[] = []

      const allFileName: string[] = await fs.readdirSync(
        JanAssistantExtension._homeDir
      )

      for (const fileName of allFileName) {
        const filePath = await joinPath([
          JanAssistantExtension._homeDir,
          fileName,
        ])

        if (!(await fs.fileStat(filePath))?.isDirectory) continue
        const jsonFiles: string[] = (await fs.readdirSync(filePath)).filter(
          (file: string) => file === 'assistant.json'
        )

        if (jsonFiles.length !== 1) {
          // has more than one assistant file -> ignore
          continue
        }

        const content = await fs.readFileSync(
          await joinPath([filePath, jsonFiles[0]]),
          'utf-8'
        )
        const assistant: Assistant =
          typeof content === 'object' ? content : JSON.parse(content)

        results.push(assistant)
      }

      return results
    } catch (err) {
      console.debug(err)
      return [this.defaultAssistant]
    }
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    if (assistant.id === 'jan') {
      return Promise.reject('Cannot delete Jan Assistant')
    }

    // remove the directory
    const assistantDir = await joinPath([
      JanAssistantExtension._homeDir,
      assistant.id,
    ])
    return fs.rm(assistantDir)
  }

  private async createJanAssistant(): Promise<void> {
    await this.createAssistant(this.defaultAssistant)
  }

  private defaultAssistant: Assistant = {
    avatar: '',
    thread_location: undefined,
    id: 'jan',
    object: 'assistant',
    created_at: Date.now(),
    name: 'Jan',
    description: 'A default assistant that can use all downloaded models',
    model: '*',
    instructions: '',
    tools: [
      {
        type: 'retrieval',
        enabled: false,
        useTimeWeightedRetriever: false,
        settings: {
          top_k: 2,
          chunk_size: 1024,
          chunk_overlap: 64,
          retrieval_template: `Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer.
----------------
CONTEXT: {CONTEXT}
----------------
QUESTION: {QUESTION}
----------------
Helpful Answer:`,
        },
      },
    ],
    file_ids: [],
    metadata: undefined,
  }
}
