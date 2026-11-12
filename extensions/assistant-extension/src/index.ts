import {
  ServiceKeys,
  joinPath,
  type Assistant,
  type AssistantService,
  type InternalExtensionContext,
} from '@janhq/core'

const V2_IDENTITY_LINE =
  'You are Jan, a helpful AI assistant who assists users with their requests. Jan is trained by Menlo Research (https://www.menlo.ai).'

/**
 * Runs the assistant migrations, seeds the default assistant on first run and
 * provides the Assistants service.
 */
export async function activate(ctx: InternalExtensionContext): Promise<void> {
  const assistants = new Assistants(ctx)
  await assistants.prepare()
  ctx.subscriptions.add(
    ctx.internal.services.provide(ServiceKeys.Assistants, assistants)
  )
}

/** Assistants stored as `file://assistants/<id>/assistant.json`. */
class Assistants implements AssistantService {
  private readonly CURRENT_MIGRATION_VERSION = 3
  private readonly MIGRATION_FILE = 'file://assistants/.migration_version'
  private readonly fs: InternalExtensionContext['internal']['fs']
  private readonly log: InternalExtensionContext['log']

  constructor(ctx: InternalExtensionContext) {
    this.fs = ctx.internal.fs
    this.log = ctx.log
  }

  /** Creates the folder, migrates and seeds; must finish before use. */
  async prepare(): Promise<void> {
    if (!(await this.fs.existsSync('file://assistants'))) {
      await this.fs.mkdir('file://assistants')
    }

    // Run migrations if needed
    await this.runMigrations()

    const assistants = await this.readAssistantsFromDisk()
    if (assistants.length === 0) {
      // Add default parameters when creating the assistant
      const assistantWithParams = {
        ...this.defaultAssistant,
        parameters: {
          temperature: 0.7,
          top_k: 20,
          top_p: 0.8,
          repeat_penalty: 1.12,
        },
      }
      await this.createAssistant(assistantWithParams as Assistant)
    }
  }

  /**
   * Gets the current migration version from storage
   */
  private async getCurrentMigrationVersion(): Promise<number> {
    try {
      if (await this.fs.existsSync(this.MIGRATION_FILE)) {
        const versionStr = await this.fs.readFileSync(this.MIGRATION_FILE)
        const version = parseInt(versionStr.trim(), 10)
        return isNaN(version) ? 0 : version
      }
    } catch (error) {
      this.log.error('Failed to read migration version:', error)
    }
    return 0
  }

  /**
   * Saves the migration version to storage
   */
  private async saveMigrationVersion(version: number): Promise<void> {
    try {
      await this.fs.writeFileSync(this.MIGRATION_FILE, version.toString())
    } catch (error) {
      this.log.error('Failed to save migration version:', error)
    }
  }

  /**
   * Runs all pending migrations
   */
  private async runMigrations(): Promise<void> {
    const currentVersion = await this.getCurrentMigrationVersion()

    if (currentVersion < 1) {
      this.log.info('Running migration v1: Update assistant instructions')
      await this.migrateAssistantInstructions()
      await this.saveMigrationVersion(1)
    }

    if (currentVersion < 2) {
      this.log.info('Running migration v2: Update to Menlo Research instructions')
      await this.migrateToMenloInstructions()
      await this.saveMigrationVersion(2)
    }

    if (currentVersion < 3) {
      this.log.info('Running migration v3: Strip identity preamble from default assistant')
      await this.migrateStripIdentityPreamble()
      await this.saveMigrationVersion(3)
    }

    this.log.info(
      `Migrations complete. Current version: ${this.CURRENT_MIGRATION_VERSION}`
    )
  }

  /**
   * Migration v1: Update assistant instructions from old format to new format
   */
  private async migrateAssistantInstructions(): Promise<void> {
    const OLD_INSTRUCTION = 'You are a helpful AI assistant.'
    const NEW_INSTRUCTION = 'You are Jan, a helpful AI assistant.' // TODO: Update with new instruction

    if (!(await this.fs.existsSync('file://assistants'))) {
      return
    }

    const assistants = await this.getAssistants()

    for (const assistant of assistants) {
      // Check if this assistant has the old instruction format
      if (assistant.instructions?.startsWith(OLD_INSTRUCTION)) {
        // Replace old instruction with new one, preserving the rest of the content
        const restOfInstructions = assistant.instructions.substring(
          OLD_INSTRUCTION.length
        )
        assistant.instructions = NEW_INSTRUCTION + restOfInstructions

        // Save the updated assistant
        const assistantPath = await joinPath([
          'file://assistants',
          assistant.id,
          'assistant.json',
        ])

        try {
          await this.fs.writeFileSync(
            assistantPath,
            JSON.stringify(assistant, null, 2)
          )
          this.log.info(`Migrated instructions for assistant: ${assistant.id}`)
        } catch (error) {
          this.log.error(`Failed to migrate assistant ${assistant.id}:`, error)
        }
      }
    }
  }

  /**
   * Migration v2: Update assistant instructions to Menlo Research format and set default parameters
   */
  private async migrateToMenloInstructions(): Promise<void> {
    const OLD_INSTRUCTION_PREFIX = 'You are Jan, a helpful AI assistant.'
    const NEW_INSTRUCTION = `${V2_IDENTITY_LINE}

You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Mandatory logical analysis:
   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.
   - Analyze the information gap: explicitly state what data is missing.
   - Derive the strategy: explain why a specific tool is the logical next step.
   - Justify parameters: explain why you chose those specific search keywords or that specific URL.

You have tools to search for and access real-time, up-to-date data. Use them. Search before stating that you can't or don't know.

Current date: {{current_date}}`

    const DEFAULT_PARAMETERS = {
      temperature: 0.7,
      top_k: 20,
      top_p: 0.8,
      repeat_penalty: 1.12,
    }

    if (!(await this.fs.existsSync('file://assistants'))) {
      return
    }

    const assistants = await this.getAssistants()

    for (const assistant of assistants) {
      // Check if this assistant has the old instruction format
      if (assistant.instructions?.startsWith(OLD_INSTRUCTION_PREFIX)) {
        assistant.instructions = NEW_INSTRUCTION

        // Add default parameters to the assistant
        const assistantWithParams = {
          ...assistant,
          parameters: DEFAULT_PARAMETERS,
        }

        // Save the updated assistant
        const assistantPath = await joinPath([
          'file://assistants',
          assistant.id,
          'assistant.json',
        ])

        try {
          await this.fs.writeFileSync(
            assistantPath,
            JSON.stringify(assistantWithParams, null, 2)
          )
          this.log.info(
            `Migrated to Menlo instructions for assistant: ${assistant.id}`
          )
        } catch (error) {
          this.log.error(`Failed to migrate assistant ${assistant.id}:`, error)
        }
      }
    }
  }

  /**
   * Migration v3: Strip the identity preamble from assistants whose instructions
   * are still the verbatim v2 default. Leaves user-customized prompts untouched.
   */
  private async migrateStripIdentityPreamble(): Promise<void> {
    if (!(await this.fs.existsSync('file://assistants'))) {
      return
    }

    const expectedOldInstructions = `${V2_IDENTITY_LINE}\n\n${this.defaultAssistant.instructions}`
    const assistants = await this.getAssistants()

    for (const assistant of assistants) {
      if (assistant.instructions !== expectedOldInstructions) continue

      assistant.instructions = this.defaultAssistant.instructions

      const assistantPath = await joinPath([
        'file://assistants',
        assistant.id,
        'assistant.json',
      ])

      try {
        await this.fs.writeFileSync(assistantPath, JSON.stringify(assistant, null, 2))
        this.log.info(`Stripped identity preamble for assistant: ${assistant.id}`)
      } catch (error) {
        this.log.error(`Failed to migrate assistant ${assistant.id}:`, error)
      }
    }
  }

  /**
   * Reads only the assistants persisted on disk. May be empty; callers that
   * need a guaranteed assistant use getAssistants (which falls back to the
   * default), while prepare uses this to decide whether to seed the default.
   */
  private async readAssistantsFromDisk(): Promise<Assistant[]> {
    if (!(await this.fs.existsSync('file://assistants'))) return []
    const assistants = await this.fs.readdirSync('file://assistants')
    const assistantsData: Assistant[] = []
    for (const assistant of assistants) {
      const assistantPath = await joinPath([
        'file://assistants',
        assistant,
        'assistant.json',
      ])
      if (!(await this.fs.existsSync(assistantPath))) continue

      try {
        const assistantData = JSON.parse(await this.fs.readFileSync(assistantPath))
        assistantsData.push(assistantData as Assistant)
      } catch (error) {
        this.log.error(`Failed to read assistant ${assistant}:`, error)
      }
    }
    return assistantsData
  }

  async getAssistants(): Promise<Assistant[]> {
    const assistantsData = await this.readAssistantsFromDisk()
    // Fall back to the default if none are persisted yet.
    return assistantsData.length > 0 ? assistantsData : [this.defaultAssistant]
  }

  async createAssistant(assistant: Assistant): Promise<void> {
    const assistantPath = await joinPath([
      'file://assistants',
      assistant.id,
      'assistant.json',
    ])
    const assistantFolder = await joinPath(['file://assistants', assistant.id])
    if (!(await this.fs.existsSync(assistantFolder))) {
      await this.fs.mkdir(assistantFolder)
    }
    await this.fs.writeFileSync(assistantPath, JSON.stringify(assistant, null, 2))
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    const assistantPath = await joinPath([
      'file://assistants',
      assistant.id,
      'assistant.json',
    ])
    if (await this.fs.existsSync(assistantPath)) {
      await this.fs.rm(assistantPath)
    }
  }

  private defaultAssistant: Assistant = {
    avatar: '\u{1F44B}',
    thread_location: undefined,
    id: 'jan',
    object: 'assistant',
    created_at: Date.now() / 1000,
    name: 'Jan',
    description:
      'Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user\u2019s behalf.',
    model: '*',
    instructions: `You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Mandatory logical analysis:
   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.
   - Analyze the information gap: explicitly state what data is missing.
   - Derive the strategy: explain why a specific tool is the logical next step.
   - Justify parameters: explain why you chose those specific search keywords or that specific URL.

You have tools to search for and access real-time, up-to-date data. Use them. Search before stating that you can't or don't know.

Current date: {{current_date}}`,
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
