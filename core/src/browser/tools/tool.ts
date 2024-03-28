import { AssistantTool, MessageRequest } from '../../types'

/**
 * Represents a base inference tool.
 */
export abstract class InferenceTool {
  abstract name: string
  /*
   ** Process a message request and return the processed message request.
   */
  abstract process(request: MessageRequest, tool?: AssistantTool): Promise<MessageRequest>
}
