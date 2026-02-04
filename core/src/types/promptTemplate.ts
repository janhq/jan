export interface PromptTemplate {
  id: string
  name: string
  trigger: string
  description: string
  template: string
  variables?: string[]
  tools?: string[]
  mcpServers?: string[]
  createdAt: number
  updatedAt: number
  source: 'user' | 'mcp'
  category?: string
}

export interface PromptTemplateVariable {
  name: string
  description?: string
  defaultValue?: string
  required?: boolean
}

export interface PromptSuggestion {
  template: PromptTemplate
  matchScore: number
}
