import { Assistant, AssistantExtension, fs, joinPath } from '@janhq/core'
export default class JanAssistantExtension extends AssistantExtension {
  async onLoad() {}

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {}

  async getAssistants(): Promise<Assistant[]> {
    if (!fs.existsSync('file://assistants')) return [this.defaultAssistant]
    const assistants = await fs.readdirSync('file://assistants')
    const assistantsData: Assistant[] = []
    for (const assistant of assistants) {
      const assistantPath = joinPath([
        'file://assistants',
        assistant,
        'assistant.json',
      ])
      if (!fs.existsSync(assistantPath)) {
        console.warn(`Assistant file not found: ${assistantPath}`)
        continue
      }
      try {
        const assistantData = JSON.parse(await fs.readFileSync(assistantPath))
        assistantsData.push(assistantData as Assistant)
      } catch (error) {
        console.error(`Failed to read assistant ${assistant}:`, error)
      }
    }
    return assistantsData
  }

  async createAssistant(assistant: Assistant): Promise<void> {
    const assistantPath = joinPath([
      'file://assistants',
      assistant.id,
      'assistant.json',
    ])
    if (!fs.existsSync('file://assistants')) {
      await fs.mkdir('file://assistants')
    }
    await fs.writeFileSync(assistantPath, JSON.stringify(assistant, null, 2))
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    const assistantPath = joinPath([
      'file://assistants',
      assistant.id,
      'assistant.json',
    ])
    if (fs.existsSync(assistantPath)) {
      await fs.unlinkSync(assistantPath)
    }
  }

  private defaultAssistant: Assistant = {
    avatar: '👋',
    thread_location: undefined,
    id: 'jan',
    object: 'assistant',
    created_at: Date.now() / 1000,
    name: 'Jan',
    description:
      'Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user’s behalf.',
    model: '*',
    instructions:
      'Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user’s behalf. Respond naturally and concisely, take actions when needed, and guide the user toward their goals.',
    tools: [
      {
        type: 'retrieval',
        enabled: false,
        useTimeWeightedRetriever: false,
        settings: {
          top_k: 2,
          chunk_size: 1024,
          chunk_overlap: 64,
          retrieval_template: `Use the following pieces of context to answer the question at the end.
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
