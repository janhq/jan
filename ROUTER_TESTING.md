# Testing the Router Implementation

## Quick Start Testing Guide

### 1. Verify Extension is Built

```bash
# Check that the router extension tarball exists
ls -la pre-install/janhq-router-extension-1.0.0.tgz

# Should show: -rw-r--r--  ... 867218 ... janhq-router-extension-1.0.0.tgz
```

### 2. Verify Core Types are Available

Open browser console in Jan app and test:

```javascript
// Check RouterManager is available
window.core?.RouterManager
// Should return the RouterManager class

// Check if router extension is loaded
const router = window.core?.RouterManager?.instance().get()
console.log(router)
// Should return RouterExtension instance or null
```

### 3. Test Routing Programmatically

In browser console:

```javascript
// Enable routing
window.useAppState.getState().setRoutingEnabled(true)

// Check state
window.useAppState.getState().routingEnabled
// Should return: true

// Get router instance
const router = window.core.RouterManager.instance().get()

// List available strategies
console.log(router.listStrategies())
// Should return:
// [
//   { name: 'heuristic', description: 'Rule-based routing using query characteristics' },
//   { name: 'llm-based', description: 'Uses a small LLM to intelligently route queries' }
// ]

// Test routing decision
const context = {
  messages: [
    { role: 'user', content: 'Write a Python function to sort a list' }
  ],
  availableModels: [
    {
      id: 'codellama-7b',
      providerId: 'llamacpp',
      capabilities: ['chat', 'code'],
      metadata: {
        parameterCount: '7B',
        contextWindow: 4096,
        isLoaded: true
      }
    },
    {
      id: 'llama-3.2-1b',
      providerId: 'llamacpp',
      capabilities: ['chat'],
      metadata: {
        parameterCount: '1B',
        contextWindow: 2048,
        isLoaded: false
      }
    }
  ],
  activeModels: ['codellama-7b'],
  attachments: {
    images: 0,
    documents: 0,
    hasCode: false
  }
}

// Get routing decision
router.route(context).then(decision => {
  console.log('Routing Decision:', decision)
  // Should prefer codellama-7b due to code capability and being loaded
})
```

### 4. Test Heuristic Router Directly

```javascript
// Import in a test file or console
import { HeuristicRouter } from '@janhq/router-extension/src/strategies/HeuristicRouter'

const heuristic = new HeuristicRouter()

// Test code query detection
const codeContext = {
  messages: [{ role: 'user', content: 'debug this function' }],
  availableModels: [
    {
      id: 'codellama',
      providerId: 'llamacpp',
      capabilities: ['code', 'chat'],
      metadata: { parameterCount: '7B', isLoaded: true }
    },
    {
      id: 'general-chat',
      providerId: 'llamacpp',
      capabilities: ['chat'],
      metadata: { parameterCount: '7B', isLoaded: false }
    }
  ],
  activeModels: ['codellama'],
  attachments: { images: 0, documents: 0, hasCode: false }
}

heuristic.route(codeContext).then(decision => {
  console.log('Code Query Decision:', decision)
  // Expected: codellama with high confidence
  // Reasoning should mention "query involves coding"
})

// Test reasoning query
const reasoningContext = {
  messages: [{ role: 'user', content: 'Why does gravity exist?' }],
  availableModels: [
    {
      id: 'reasoning-model',
      providerId: 'llamacpp',
      capabilities: ['chat', 'reasoning'],
      metadata: { parameterCount: '70B', isLoaded: false }
    },
    {
      id: 'fast-chat',
      providerId: 'llamacpp',
      capabilities: ['chat'],
      metadata: { parameterCount: '3B', isLoaded: true }
    }
  ],
  activeModels: ['fast-chat'],
  attachments: { images: 0, documents: 0, hasCode: false }
}

heuristic.route(reasoningContext).then(decision => {
  console.log('Reasoning Query Decision:', decision)
  // May prefer reasoning-model despite not being loaded
})
```

### 5. Test Strategy Switching

```javascript
const router = window.core.RouterManager.instance().get()

// Get current strategy
console.log(router.getStrategy().name)
// Should return: 'heuristic'

// Switch to LLM-based
router.setStrategyByName('llm-based')
console.log(router.getStrategy().name)
// Should return: 'llm-based'

// Switch back
router.setStrategyByName('heuristic')
```

### 6. Test Settings Persistence

```javascript
import { fs, joinPath } from '@janhq/core'

// Save routing strategy
const router = window.core.RouterManager.instance().get()
router.setStrategyByName('llm-based')

// Check saved settings
const settingsPath = await joinPath(['file://settings', 'router.json'])
const settings = await fs.readFileSync(settingsPath)
console.log(JSON.parse(settings))
// Should return: { strategy: 'llm-based' }

// Reload and verify persistence
// (This would happen automatically on app restart)
```

## Unit Test Examples

Create `extensions/router-extension/src/strategies/HeuristicRouter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { HeuristicRouter } from './HeuristicRouter'
import { RouteContext, AvailableModel } from '@janhq/core'

describe('HeuristicRouter', () => {
  const createContext = (
    query: string,
    models: AvailableModel[]
  ): RouteContext => ({
    messages: [{ role: 'user', content: query }],
    availableModels: models,
    activeModels: [],
    attachments: { images: 0, documents: 0, hasCode: false },
  })

  const codeModel: AvailableModel = {
    id: 'codellama',
    providerId: 'llamacpp',
    capabilities: ['code', 'chat'],
    metadata: { parameterCount: '7B', isLoaded: false },
  }

  const chatModel: AvailableModel = {
    id: 'llama-chat',
    providerId: 'llamacpp',
    capabilities: ['chat'],
    metadata: { parameterCount: '7B', isLoaded: true },
  }

  it('should prefer code model for code queries', async () => {
    const router = new HeuristicRouter()
    const context = createContext(
      'Write a function to sort an array',
      [codeModel, chatModel]
    )

    const decision = await router.route(context)

    expect(decision.modelId).toBe('codellama')
    expect(decision.confidence).toBeGreaterThan(0.7)
    expect(decision.reasoning).toContain('coding')
  })

  it('should prefer loaded model when capabilities match', async () => {
    const router = new HeuristicRouter()
    const context = createContext('Hello, how are you?', [codeModel, chatModel])

    const decision = await router.route(context)

    expect(decision.modelId).toBe('llama-chat')
    expect(decision.reasoning).toContain('already loaded')
  })

  it('should handle vision queries', async () => {
    const visionModel: AvailableModel = {
      id: 'llava',
      providerId: 'llamacpp',
      capabilities: ['vision', 'chat'],
      metadata: { parameterCount: '13B', isLoaded: false },
    }

    const router = new HeuristicRouter()
    const context = createContext('What is in this image?', [
      visionModel,
      chatModel,
    ])
    context.attachments = { images: 1, documents: 0, hasCode: false }

    const decision = await router.route(context)

    expect(decision.modelId).toBe('llava')
    expect(decision.reasoning).toContain('images')
  })
})
```

Run tests:

```bash
cd extensions/router-extension
yarn test
```

## Integration Test Scenarios

### Scenario 1: Code Assistant Workflow

1. Enable routing: `useAppState.getState().setRoutingEnabled(true)`
2. User asks: "Write a Python function to calculate fibonacci numbers"
3. Expected:
   - Router detects code keywords
   - Selects code-capable model
   - Confidence > 0.8
   - Reasoning mentions "coding"

### Scenario 2: Multi-Modal Query

1. User uploads image
2. User asks: "What objects are in this image?"
3. Expected:
   - Router detects images in context
   - Selects vision-capable model
   - Confidence > 0.9
   - Reasoning mentions "images"

### Scenario 3: Simple Chat

1. User asks: "What's the weather like?"
2. No special capabilities needed
3. Expected:
   - Router selects currently loaded model (avoid switching)
   - Or smallest available model for speed
   - Reasoning mentions "already loaded" or "best match"

### Scenario 4: Complex Reasoning

1. User asks: "Explain why quantum entanglement doesn't violate causality"
2. Long, complex question requiring deep analysis
3. Expected:
   - Router detects reasoning keywords ("explain", "why")
   - Selects larger model or reasoning-capable model
   - Confidence moderate to high

## Debugging Tips

### Router Not Loading

```javascript
// Check if extension is registered
const manager = window.core?.extensionManager
const extensions = manager?.list()
console.log(extensions)
// Should include router extension

// Force load router
const router = new RouterExtension(
  'file://router-extension',
  '@janhq/router-extension',
  'Jan Router'
)
await router.onLoad()
window.core.RouterManager.instance().register(router)
```

### Routing Not Working

```javascript
// Check routing is enabled
console.log(window.useAppState.getState().routingEnabled)
// Should be true

// Check router is available
const router = window.core.RouterManager.instance().get()
console.log(router)
// Should not be null

// Manually trigger routing
const decision = await router.route({
  messages: [{ role: 'user', content: 'test' }],
  availableModels: [...], // Your models
  activeModels: [],
  attachments: { images: 0, documents: 0, hasCode: false }
})
console.log(decision)
```

### Strategy Not Switching

```javascript
// Check available strategies
const router = window.core.RouterManager.instance().get()
console.log(router.listStrategies())

// Force strategy change
const success = router.setStrategyByName('llm-based')
console.log('Strategy changed:', success)
console.log('Current strategy:', router.getStrategy().name)
```

## Performance Testing

```javascript
// Measure routing time
const router = window.core.RouterManager.instance().get()

const context = {
  messages: [{ role: 'user', content: 'Write code to parse JSON' }],
  availableModels: [...], // 10-20 models
  activeModels: [],
  attachments: { images: 0, documents: 0, hasCode: false }
}

const start = performance.now()
const decision = await router.route(context)
const elapsed = performance.now() - start

console.log(`Routing took ${elapsed.toFixed(2)}ms`)
console.log('Decision:', decision)

// Heuristic should be < 10ms
// LLM-based will be slower when fully implemented
```

## Expected Console Output

When routing is working correctly, you should see:

```
[RouterExtension] Loading model router
[RouterExtension] Active strategy: heuristic
[RouterExtension] Routing with strategy: heuristic
[RouterExtension] Routed to codellama-7b (3.2ms) - Selected codellama-7b because: query involves coding, model already loaded
[RouterExtension] Decision: {
  timestamp: 1700000000000,
  strategy: 'heuristic',
  decision: {
    modelId: 'codellama-7b',
    providerId: 'llamacpp',
    confidence: 1,
    reasoning: 'Selected codellama-7b because: query involves coding, model already loaded',
    metadata: { ... }
  },
  elapsed: 3.2,
  queryLength: 42
}
```

## Common Issues

### "Cannot find module '@janhq/core'"
- Run `yarn install` in router-extension directory
- Ensure core package is built and packed

### "Router is null"
- Extension may not be loaded yet
- Check ExtensionProvider is initializing extensions
- Manually register as shown in debugging tips

### "No models available for routing"
- availableModels array is empty
- Check that models are loaded in ModelProvider
- Verify buildAvailableModels() helper is correct

### Routing decisions don't match expectations
- Check model capabilities are correctly inferred
- Verify scoring logic in HeuristicRouter
- Add debug logging to scoreModel() method
- Review query keyword lists (isCodeQuery, etc.)

## Next: Production Testing

Once UI integration is complete:

1. Test with real user workflows
2. Monitor routing decisions
3. Collect user feedback
4. Tune heuristic weights
5. Implement LLM-based router fully
6. Add caching for performance
7. Create analytics dashboard
