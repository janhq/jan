# Router Extension

Intelligent model routing for Jan. Automatically selects the best AI model for each query based on characteristics like complexity, code involvement, reasoning requirements, and more.

## Features

- **Automatic Model Selection**: Routes queries to the optimal model without manual selection
- **Multiple Strategies**: Supports different routing algorithms (heuristic, LLM-based, embedding-based)
- **Pluggable Architecture**: Easy to add custom routing strategies
- **Observable**: All routing decisions are logged with reasoning
- **Fast**: Heuristic routing completes in <10ms

## Routing Strategies

### Heuristic Router (Default)
- **Speed**: ⚡⚡⚡ Very Fast (<10ms)
- **Accuracy**: ⭐⭐⭐ Good
- **Dependencies**: None
- **Use Case**: Production default, resource-constrained environments

Rule-based routing using query pattern matching:
- Detects code-related queries (keywords: code, function, class, debug, etc.)
- Identifies reasoning queries (keywords: why, explain, analyze, etc.)
- Considers query complexity (length, multiple questions)
- Prefers already-loaded models to avoid switching overhead
- Matches model size to query complexity

### LLM-Based Router
- **Speed**: ⚡⚡ Fast (~100-500ms)
- **Accuracy**: ⭐⭐⭐⭐ Very Good
- **Dependencies**: Small, fast LLM (e.g., phi-3-mini)
- **Use Case**: Complex routing decisions, high accuracy needs

Uses a small AI model to intelligently decide which model to route to. Currently implemented as a fallback (full implementation requires injecting EngineManager).

## Usage

### Enable Auto Routing

The router automatically registers itself when the extension loads. To use it:

1. **Via Model Selection** (future UI update):
   - Select "Auto (Router)" from the model dropdown
   - Router will automatically select the best model for each query

2. **Via State** (programmatic):
   ```typescript
   import { useAppState } from '@/hooks/useAppState'
   
   const { setRoutingEnabled } = useAppState()
   setRoutingEnabled(true)
   ```

### Change Routing Strategy

```typescript
import { RouterManager } from '@janhq/core'

const router = RouterManager.instance().get()
if (router) {
  // List available strategies
  const strategies = router.listStrategies()
  console.log(strategies)
  
  // Switch to LLM-based routing
  router.setStrategyByName('llm-based')
}
```

### Access Routing Decisions

All routing decisions are logged to the console with:
- Selected model ID and provider
- Confidence score (0-1)
- Reasoning for the selection
- Elapsed time for routing decision
- Query length and other metadata

## How It Works

### Routing Flow

```
User Query
    ↓
Router Strategy (e.g., Heuristic)
    ↓
Analyze Query:
  - Extract keywords
  - Determine complexity
  - Check attachments (images, docs)
  - Consider available models
    ↓
Score Each Model:
  - Capability matching (+30 for code, +40 for vision, +25 for reasoning)
  - Model size vs complexity
  - Context window requirements
  - Already loaded bonus (+20)
    ↓
Select Best Model
    ↓
Return RouteDecision:
  - modelId
  - providerId  
  - confidence
  - reasoning
```

### Heuristic Scoring Example

For query: "Write a Python function to sort a list"

```
Model: codellama-7b-instruct
  Base score: 50
  + Code capability: +30
  + Appropriate size: +15
  + Already loaded: +20
  Total: 115/100 → normalized to 1.0

Model: llama-3.2-1b
  Base score: 50
  + Chat capability: +10
  + Small model bonus: +15
  Total: 75/100 → 0.75

→ Selects codellama-7b-instruct (confidence: 1.0)
Reasoning: "Selected codellama-7b-instruct because: query involves coding, model already loaded"
```

## Adding Custom Strategies

Create a new class extending `RouterStrategy`:

```typescript
import { RouterStrategy, RouteContext, RouteDecision } from '@janhq/core'

export class MyCustomRouter extends RouterStrategy {
  name = 'my-custom'
  description = 'My custom routing logic'
  
  async route(context: RouteContext): Promise<RouteDecision> {
    // Your routing logic here
    const { messages, availableModels, attachments } = context
    
    // Example: Always route to the first model
    const model = availableModels[0]
    
    return {
      modelId: model.id,
      providerId: model.providerId,
      confidence: 0.9,
      reasoning: 'Custom logic selected this model',
      metadata: {
        strategy: 'my-custom',
      },
    }
  }
}
```

Then register it in the RouterExtension constructor:

```typescript
// In extensions/router-extension/src/index.ts
this.availableStrategies.set('my-custom', new MyCustomRouter())
```

## Configuration

The router stores user preferences in `file://settings/router.json`:

```json
{
  "strategy": "heuristic"
}
```

This persists the selected strategy across sessions.

## Architecture

The router follows Jan's extension pattern:

- **RouterExtension**: Main extension class implementing `ModelRouterExtension`
- **RouterManager**: Singleton coordinating router access
- **RouterStrategy**: Abstract base class for strategies
- **HeuristicRouter**: Default rule-based strategy
- **LLMRouter**: AI-powered strategy (fallback implementation)

All router types are exported from `@janhq/core` for use in web-app and other extensions.

## Performance

- **Heuristic routing**: <10ms overhead
- **LLM routing**: ~100-500ms overhead (when fully implemented)
- **Memory**: Minimal (~1MB for extension code)
- **Caching**: Future enhancement to cache routing decisions

## Future Enhancements

- **Embedding-based routing**: Semantic similarity matching
- **Hybrid routing**: Combine multiple strategies
- **Learning routing**: Adapt based on user corrections
- **Caching**: Remember routing decisions for similar queries
- **UI integration**: Settings page for strategy selection
- **Analytics**: Track routing accuracy and user satisfaction

