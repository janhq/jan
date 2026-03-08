# Contributing to Jan Core

[← Back to Main Contributing Guide](../CONTRIBUTING.md)

TypeScript SDK providing extension system, APIs, and type definitions for all Jan components.

## Key Directories

- **`/src/browser`** - Core APIs (events, extensions, file system)
- **`/src/browser/extensions`** - Built-in extensions (assistant, inference, conversational)
- **`/src/types`** - TypeScript type definitions
- **`/src/test`** - Testing utilities

## Development

### Key Principles

1. **Platform Agnostic** - Works everywhere (browser, Node.js)
2. **Extension-Based** - New features = new extensions  
3. **Type Everything** - TypeScript required
4. **Event-Driven** - Components communicate via events

### Building & Testing

```bash
# Build the SDK
yarn build

# Run tests  
yarn test

# Watch mode
yarn test:watch
```

### Event System

```typescript
// Emit events
events.emit('model:loaded', { modelId: 'llama-3' })

// Listen for events
events.on('model:loaded', (data) => {
  console.log('Model loaded:', data.modelId)
})
```

## Testing

```typescript
describe('MyFeature', () => {
  it('should do something', () => {
    const result = doSomething()
    expect(result).toBe('expected')
  })
})
```

## Best Practices

- Keep it simple
- Use TypeScript fully (no `any`)
- Write tests for critical features
- Follow existing patterns
- Export new modules in index files

## Dependencies

- **TypeScript** - Type safety
- **Rolldown** - Bundling
- **Vitest** - Testing
