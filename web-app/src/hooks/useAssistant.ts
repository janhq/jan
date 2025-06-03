import { createAssistant, deleteAssistant } from '@/services/assistants'
import { Assistant as CoreAssistant } from '@janhq/core'
import { create } from 'zustand'

interface AssistantState {
  assistants: Assistant[]
  currentAssistant: Assistant
  addAssistant: (assistant: Assistant) => void
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => void
  setCurrentAssistant: (assistant: Assistant) => void
  setAssistants: (assistants: Assistant[]) => void
}

export const defaultAssistant: Assistant = {
  id: 'jan',
  name: 'Jan',
  created_at: 1747029866.542,
  parameters: {},
  avatar: '👋',
  description:
    'Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user\'s behalf.',
  instructions:
    'Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user\'s behalf. Respond naturally and concisely, take actions when needed, and guide the user toward their goals.',
}

export const ragAssistant: Assistant = {
  id: 'rag',
  name: 'RAG',
  created_at: 1747029866.542,
  parameters: {},
  avatar: '📚',
  description:
    'A specialized assistant that uses document knowledge base integration to provide enhanced responses based on your uploaded documents.',
  instructions: `# Document Knowledge Base Integration

## Available Tools

### rag_query_documents
**Purpose**: Search for relevant information from indexed documents
**Parameters**:
- query_text (required): Search terms or natural language query
- top_k (optional, default: 3): Number of results to retrieve (adjust based on query complexity)

**Best Practices**:
- Use specific, relevant keywords for targeted searches
- For broad topics, start with general terms then refine with follow-up queries
- Consider synonyms and related terms if initial queries yield limited results
- Increase top_k (5-10) for complex questions requiring multiple perspectives

### rag_list_data_sources
**Purpose**: View available documents in the knowledge base
**When to use**: 
- When users ask about available resources
- To understand the scope of information available
- Before conducting searches to better target queries

## Workflow Guidelines

### 1. Query Assessment
- **Always search first** when users ask questions that could benefit from document context
- **Exception**: Only skip searching for purely computational, creative, or general knowledge tasks

### 2. Search Strategy
- **Single focused topic**: Use 1-2 targeted queries
- **Complex/multi-faceted questions**: Use multiple complementary searches
- **Unclear questions**: Start broad, then narrow based on initial results

### 3. Response Construction
- **Lead with retrieved information** when available and relevant
- **Integrate context naturally** rather than simply appending it
- **Synthesize multiple sources** when using several document chunks
- **Acknowledge limitations** if relevant information isn't found

## Citation Requirements

### Format
- Use clear source attribution: "According to [Document Name]..." or "As stated in [Document Title]..."
- Include page numbers or section references when available
- For multiple sources: "Based on information from [Source A] and [Source B]..."

### When to Cite
- **Always cite** when directly referencing document content
- **Distinguish** between document-sourced information and your general knowledge
- **Be transparent** about the source of specific claims or data points

## Response Framework

\`\`\`
1. Search the knowledge base using rag_query_documents
2. Evaluate retrieved information for relevance and quality
3. If insufficient, conduct additional targeted searches
4. Construct response integrating:
   - Retrieved document context (cited)
   - Your analysis and synthesis
   - Clear distinction between sources
5. Acknowledge any limitations in available information
\`\`\`

## Error Handling

- **No relevant results**: Acknowledge the limitation and provide general knowledge if appropriate
- **Tool failures**: Inform the user and offer to help based on general knowledge
- **Conflicting information**: Present multiple perspectives and note discrepancies

## Quality Indicators

✅ **Good Practice**:
- Search before responding to relevant queries
- Cite sources clearly and accurately
- Synthesize information from multiple documents
- Acknowledge when information comes from documents vs. general knowledge

❌ **Avoid**:
- Responding without searching when documents might be relevant
- Vague or missing citations
- Presenting document information as your own knowledge
- Over-relying on single sources for complex topics`,
}

export const useAssistant = create<AssistantState>()((set, get) => ({
  assistants: [defaultAssistant, ragAssistant],
  currentAssistant: defaultAssistant,
  addAssistant: (assistant) => {
    set({ assistants: [...get().assistants, assistant] })
    createAssistant(assistant as unknown as CoreAssistant).catch((error) => {
      console.error('Failed to create assistant:', error)
    })
  },
  updateAssistant: (assistant) => {
    const state = get()
    set({
      assistants: state.assistants.map((a) =>
        a.id === assistant.id ? assistant : a
      ),
      // Update currentAssistant if it's the same assistant being updated
      currentAssistant:
        state.currentAssistant.id === assistant.id
          ? assistant
          : state.currentAssistant,
    })
    // Create assistant already cover update logic
    createAssistant(assistant as unknown as CoreAssistant).catch((error) => {
      console.error('Failed to update assistant:', error)
    })
  },
  deleteAssistant: (id) => {
    deleteAssistant(
      get().assistants.find((e) => e.id === id) as unknown as CoreAssistant
    ).catch((error) => {
      console.error('Failed to delete assistant:', error)
    })
    set({ assistants: get().assistants.filter((a) => a.id !== id) })
  },
  setCurrentAssistant: (assistant) => {
    set({ currentAssistant: assistant })
  },
  setAssistants: (assistants) => {
    set({ assistants })
  },
}))
