/**
 * Assistant type defines the shape of an assistant object.
 * @stored
 */

export type AssistantTool = {
  type: string
  enabled: boolean
  useTimeWeightedRetriever?: boolean
  settings: any
}

export type Assistant = {
  /** Represents the avatar of the user. */
  avatar: string
  /** Represents the location of the thread. */
  thread_location: string | undefined
  /** Represents the unique identifier of the object. */
  id: string
  /** Represents the object. */
  object: string
  /** Represents the creation timestamp of the object. */
  created_at: number
  /** Represents the name of the object. */
  name: string
  /** Represents the description of the object. */
  description?: string
  /** Represents the model of the object. */
  model: string
  /** Represents the instructions for the object. */
  instructions?: string
  /** Represents the tools associated with the object. */
  tools?: AssistantTool[]
  /** Represents the file identifiers associated with the object. */
  file_ids: string[]
  /** Represents the metadata of the object. */
  metadata?: Record<string, unknown>
}

export interface CodeInterpreterTool {
  /**
   * The type of tool being defined: `code_interpreter`
   */
  type: 'code_interpreter'
}
