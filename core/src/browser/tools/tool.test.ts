import { ToolManager } from '../../browser/tools/manager'
import { InferenceTool } from '../../browser/tools/tool'
import { AssistantTool, MessageRequest } from '../../types'

class MockInferenceTool implements InferenceTool {
  name = 'mockTool'
  process(request: MessageRequest, tool: AssistantTool): Promise<MessageRequest> {
    return Promise.resolve(request)
  }
}

it('should register a tool', () => {
  const manager = new ToolManager()
  const tool = new MockInferenceTool()
  manager.register(tool)
  expect(manager.get(tool.name)).toBe(tool)
})

it('should retrieve a tool by its name', () => {
  const manager = new ToolManager()
  const tool = new MockInferenceTool()
  manager.register(tool)
  const retrievedTool = manager.get(tool.name)
  expect(retrievedTool).toBe(tool)
})

it('should return undefined for a non-existent tool', () => {
  const manager = new ToolManager()
  const retrievedTool = manager.get('nonExistentTool')
  expect(retrievedTool).toBeUndefined()
})

it('should process the message request with enabled tools', async () => {
  const manager = new ToolManager()
  const tool = new MockInferenceTool()
  manager.register(tool)

  const request: MessageRequest = { message: 'test' } as any
  const tools: AssistantTool[] = [{ type: 'mockTool', enabled: true }] as any

  const result = await manager.process(request, tools)
  expect(result).toBe(request)
})

it('should skip processing for disabled tools', async () => {
  const manager = new ToolManager()
  const tool = new MockInferenceTool()
  manager.register(tool)

  const request: MessageRequest = { message: 'test' } as any
  const tools: AssistantTool[] = [{ type: 'mockTool', enabled: false }] as any

  const result = await manager.process(request, tools)
  expect(result).toBe(request)
})

it('should throw an error when process is called without implementation', () => {
  class TestTool extends InferenceTool {
    name = 'testTool'
  }
  const tool = new TestTool()
  expect(() => tool.process({} as MessageRequest)).toThrowError()
})
