# Contributing to Jan Extensions

[← Back to Main Contributing Guide](../CONTRIBUTING.md)

Extensions add specific features to Jan as self-contained modules.

## Current Extensions

### `/assistant-extension`
- Assistant CRUD operations
- `src/index.ts` - Main implementation

### `/conversational-extension` 
- Message handling, conversation state
- `src/index.ts` - Chat logic

### `/download-extension`
- Model downloads with progress tracking
- `src/index.ts` - Download logic
- `settings.json` - Download settings

### `/llamacpp-extension`
- Local model inference via llama.cpp
- `src/index.ts` - Entry point
- `src/backend.ts` - llama.cpp integration
- `settings.json` - Model settings

## Creating Extensions

### Setup

```bash
mkdir my-extension
cd my-extension  
yarn init
```

### Structure

```
my-extension/
├── package.json
├── rolldown.config.mjs
├── src/index.ts
└── settings.json (optional)
```

### Basic Extension

```typescript
import { Extension } from '@janhq/core'

export default class MyExtension extends Extension {
  async onLoad() {
    // Extension initialization
  }
  
  async onUnload() {
    // Cleanup
  }
}
```

## Building & Testing

```bash
# Build extension
yarn build

# Run tests
yarn test
```

## Common Patterns

### Service Registration
```typescript
async onLoad() {
  this.registerService('myService', {
    doSomething: async () => 'result'
  })
}
```

### Event Handling  
```typescript
async onLoad() {
  this.on('model:loaded', (model) => {
    console.log('Model loaded:', model.id)
  })
}
```

## Extension Lifecycle

1. **Jan starts** → Discovers extensions
2. **Loading** → Calls `onLoad()` method  
3. **Active** → Extension responds to events
4. **Unloading** → Calls `onUnload()` on shutdown

## Debugging Extensions

```bash
# Check if extension loaded
console.log(window.core.extensions)

# Debug extension events
this.on('*', console.log)

# Check extension services
console.log(window.core.api)
```

## Common Issues

**Extension not loading?**
- Check package.json format: `@janhq/extension-name`
- Ensure `onLoad()` doesn't throw errors
- Verify exports in index.ts

**Events not working?**
- Check event name spelling
- Ensure listeners are set up in `onLoad()`

## Best Practices

- Keep extensions focused on one feature
- Use async/await for all operations
- Clean up resources in onUnload()
- Handle errors gracefully
- Don't depend on other extensions

## Dependencies

- **@janhq/core** - Core SDK and extension system
- **TypeScript** - Type safety
- **Rolldown** - Bundling