type ToolCall = {
  tool: {
    id?: number
    function?: {
      name?: string
      arguments?: object
    }
  }
<<<<<<< HEAD
  response?: unknown
=======
  response?: MCPResponse
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  state?: string
}
