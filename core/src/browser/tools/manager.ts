import { AssistantTool, MessageRequest } from '../../types'
import { InferenceTool } from './tool'

/**
 * Manages the registration and retrieval of inference tools.
 */
export class ToolManager {
  public tools = new Map<string, InferenceTool>()

  /**
   * Registers a tool.
   * @param tool - The tool to register.
   */
  register<T extends InferenceTool>(tool: T) {
    this.tools.set(tool.name, tool)
  }

  /**
   * Retrieves a tool by it's name.
   * @param name - The name of the tool to retrieve.
   * @returns The tool, if found.
   */
  get<T extends InferenceTool>(name: string): T | undefined {
    return this.tools.get(name) as T | undefined
  }

  /*
   ** Process the message request with the tools.
   */
  process(request: MessageRequest, tools: AssistantTool[]): Promise<MessageRequest> {
    return tools.reduce((prevPromise, currentTool) => {
      return prevPromise.then((prevResult) => {
        return currentTool.enabled
          ? this.get(currentTool.type)?.process(prevResult, currentTool) ??
              Promise.resolve(prevResult)
          : Promise.resolve(prevResult)
      })
    }, Promise.resolve(request))
  }

  /**
   * The instance of the tool manager.
   */
  static instance(): ToolManager {
    return (window.core?.toolManager as ToolManager) ?? new ToolManager()
  }
}
