type ToolCall = {
  tool: {
    id?: number
    function?: {
      name?: string
      arguments?: object
    }
  }
  response?: MCPResponse
  state?: string
}
