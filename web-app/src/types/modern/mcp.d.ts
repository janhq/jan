interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  server: string;
}

interface MCPToolCallResult {
  error: string;
  content: Array<{
    type?: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
}

interface GetToolsResponse {
  object: string;
  data: MCPTool[];
}

interface CallToolPayload {
  toolName: string;
  serverName?: string;
  arguments: Record<string, unknown>;
  conversationId?: string;
  toolCallId?: string;
}

interface ToolCallClient {
  getTools(): Promise<MCPTool[]>;
  callTool(
    payload: CallToolPayload,
    metadata?: {
      conversationId?: string;
      toolCallId?: string;
      signal?: AbortSignal;
    },
  ): Promise<MCPToolCallResult>;
  disconnect(): Promise<void>;
  refreshTools(): Promise<void>;
  isHealthy(): Promise<boolean>;
}
