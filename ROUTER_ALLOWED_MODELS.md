# Router Allowed Models Configuration

## Overview

This document describes the implementation of a configuration file that enumerates the list of allowed models for the router extension. The configuration is accessible through the Settings UI.

## Implementation Summary

### 1. Configuration File (`extensions/router-extension/settings.json`)

Created a settings configuration file following Jan's extension settings pattern:

```json
[
  {
    "key": "allowed_models",
    "title": "Allowed Models",
    "description": "Comma-separated list of model IDs that the router is allowed to select. Leave empty to allow all models.",
    "controllerType": "input",
    "controllerProps": {
      "value": "Qwen3-VL-8B-Instruct-IQ4_XS,gemma-3n-E4B-it-IQ4_XS",
      "placeholder": "e.g., Qwen3-VL-8B-Instruct-IQ4_XS,gemma-3n-E4B-it-IQ4_XS",
      "type": "text"
    }
  }
]
```

**Default Models:**
- `Qwen3-VL-8B-Instruct-IQ4_XS`
- `gemma-3n-E4B-it-IQ4_XS`

### 2. Build Configuration (`extensions/router-extension/rolldown.config.mjs`)

Updated the Rolldown configuration to inject the settings at build time:

```javascript
import settingJson from './settings.json' with { type: 'json' }

export default defineConfig([
  {
    // ...
    define: {
      NODE: JSON.stringify(`${pkgJson.name}/${pkgJson.node}`),
      VERSION: JSON.stringify(pkgJson.version),
      SETTINGS: JSON.stringify(settingJson), // ← Added
    },
  }
])
```

### 3. TypeScript Types (`extensions/router-extension/src/env.d.ts`)

Created type declarations for the global SETTINGS constant:

```typescript
import type { SettingComponentProps } from '@janhq/core'

declare global {
  const SETTINGS: SettingComponentProps[]
}

export {}
```

### 4. Extension Logic (`extensions/router-extension/src/index.ts`)

#### Added Private Field
```typescript
private allowedModels: string[] = []
```

#### Settings Registration in `onLoad()`
```typescript
async onLoad() {
  // Register settings
  const settings = structuredClone(SETTINGS)
  await this.registerSettings(settings)

  // Load allowed models from settings
  const allowedModelsStr = await this.getSetting<string>(
    'allowed_models',
    'Qwen3-VL-8B-Instruct-IQ4_XS,gemma-3n-E4B-it-IQ4_XS'
  )
  this.allowedModels = this.parseAllowedModels(allowedModelsStr)
  console.log('[RouterExtension] Allowed models:', this.allowedModels)
  
  // ... rest of initialization
}
```

#### Model Filtering in `route()`
```typescript
async route(context: RouteContext): Promise<RouteDecision> {
  // Filter available models by allowed models list
  const filteredContext = {
    ...context,
    availableModels: this.filterAllowedModels(context.availableModels),
  }

  if (filteredContext.availableModels.length === 0) {
    console.warn('[RouterExtension] No allowed models available for routing')
    // Fall back to original models if no allowed models match
    const decision = await this.activeStrategy.route(context)
    return decision
  }

  const decision = await this.activeStrategy.route(filteredContext)
  // ...
}
```

#### Helper Methods
```typescript
private parseAllowedModels(allowedModelsStr: string): string[] {
  if (!allowedModelsStr || allowedModelsStr.trim() === '') {
    return []
  }
  return allowedModelsStr
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
}

private filterAllowedModels(availableModels: any[]): any[] {
  // If no allowed models configured, return all available models
  if (this.allowedModels.length === 0) {
    return availableModels
  }

  // Filter models to only include those in the allowed list
  return availableModels.filter((model) => this.allowedModels.includes(model.id))
}

onSettingUpdate<T>(key: string, value: T): void {
  if (key === 'allowed_models') {
    this.allowedModels = this.parseAllowedModels(value as string)
    console.log('[RouterExtension] Updated allowed models:', this.allowedModels)
  }
}
```

### 5. Settings UI (`web-app/src/routes/settings/router.tsx`)

#### Added State Management
```typescript
const [allowedModels, setAllowedModels] = useState<string>('')
```

#### Settings Loading
```typescript
const loadRouterSettings = useCallback(async () => {
  // ... existing code
  
  // Load allowed models setting
  if (router.getSettings) {
    const settings = await router.getSettings()
    const allowedModelsSetting = settings.find(s => s.key === 'allowed_models')
    if (allowedModelsSetting) {
      setAllowedModels(allowedModelsSetting.controllerProps.value as string)
    }
  }
  // ...
}, [loading])
```

#### Update Handler
```typescript
const handleAllowedModelsChange = useCallback(
  async (value: string) => {
    setAllowedModels(value)
    try {
      const router = RouterManager.instance().get()
      if (router && router.updateSettings) {
        await router.updateSettings([
          { key: 'allowed_models', controllerProps: { value } }
        ])
        console.log('[Router Settings] Updated allowed models:', value)
      }
    } catch (error) {
      console.error('Failed to update allowed models:', error)
    }
  },
  []
)
```

#### UI Component
```tsx
<Card title="Allowed Models">
  <CardItem
    title="Model Whitelist"
    description="Comma-separated list of model IDs that the router is allowed to select. Leave empty to allow all models."
    className="flex-col sm:flex-row items-start gap-y-2"
  />
  <div className="px-4 pb-4">
    <input
      type="text"
      value={allowedModels}
      onChange={(e) => handleAllowedModelsChange(e.target.value)}
      placeholder="e.g., Qwen3-VL-8B-Instruct-IQ4_XS,gemma-3n-E4B-it-IQ4_XS"
      className="w-full px-3 py-2 text-sm border border-main-view-fg/10 rounded-lg bg-transparent text-main-view-fg focus:outline-none focus:border-primary"
    />
    <p className="text-xs text-main-view-fg/60 mt-2">
      Example: <code className="px-1 py-0.5 bg-main-view-fg/5 rounded">Qwen3-VL-8B-Instruct-IQ4_XS,gemma-3n-E4B-it-IQ4_XS</code>
    </p>
  </div>
</Card>
```

## Features

### 1. **Model Whitelisting**
- Only models in the allowed list will be considered for routing decisions
- Prevents the router from selecting unauthorized or unwanted models

### 2. **Empty List Behavior**
- If the allowed models list is empty, ALL available models are allowed
- This provides flexibility for users who don't want restrictions

### 3. **Graceful Fallback**
- If no allowed models match the available models, the router falls back to using all available models
- Prevents routing failures due to misconfiguration

### 4. **Real-time Updates**
- Changes to the allowed models list are applied immediately via `onSettingUpdate()`
- No need to restart the application

### 5. **Settings Persistence**
- Uses Jan's localStorage-based settings persistence
- Settings survive app restarts

## How to Use

### Via Settings UI

1. Open Jan application
2. Navigate to **Settings → Router**
3. Find the **Allowed Models** section
4. Enter comma-separated model IDs in the text field
5. Changes are saved automatically

### Example Configurations

**Default (Qwen + Gemma):**
```
Qwen3-VL-8B-Instruct-IQ4_XS,gemma-3n-E4B-it-IQ4_XS
```

**Allow All Models:**
```
(leave empty)
```

**Single Model:**
```
Qwen3-VL-8B-Instruct-IQ4_XS
```

**Multiple Models:**
```
model-1-id,model-2-id,model-3-id
```

## Architecture Integration

### Extension Settings Pattern
Follows the same pattern as other Jan extensions:
- `settings.json` defines the UI schema
- `SETTINGS` constant injected at build time
- `registerSettings()` called in `onLoad()`
- `getSetting()` retrieves values
- `updateSettings()` persists changes
- `onSettingUpdate()` handles real-time updates

### Router Flow
```
User Query
    ↓
RouteContext (with all available models)
    ↓
RouterExtension.route()
    ↓
Filter by allowedModels list
    ↓
Filtered RouteContext
    ↓
Strategy.route() (HeuristicRouter/LLMRouter)
    ↓
RouteDecision (selected model)
```

## Files Changed

1. **Created:**
   - `extensions/router-extension/settings.json`
   - `extensions/router-extension/src/env.d.ts`

2. **Modified:**
   - `extensions/router-extension/rolldown.config.mjs`
   - `extensions/router-extension/src/index.ts`
   - `web-app/src/routes/settings/router.tsx`

## Build & Deploy

```bash
# Build router extension
cd extensions/router-extension
yarn build

# Package extension
npm pack
mv *.tgz ../../pre-install/

# Re-link workspace
cd ../..
yarn install

# Clear Vite cache
rm -rf web-app/node_modules/.vite

# Start dev server
make dev
```

## Testing Checklist

- [ ] Settings UI loads without errors
- [ ] Default models appear in the input field
- [ ] Changing the allowed models updates the setting
- [ ] Settings persist after app restart
- [ ] Router only selects allowed models
- [ ] Empty list allows all models
- [ ] Invalid model IDs are gracefully handled
- [ ] Console logs show filtered models

## Future Enhancements

1. **Model Validation**: Add UI to validate that entered model IDs exist
2. **Multi-select Dropdown**: Replace text input with checkboxes for available models
3. **Model Groups**: Allow grouping models by capability (code, vision, reasoning)
4. **Import/Export**: Add ability to import/export allowed models configurations
5. **Per-Thread Overrides**: Allow specific threads to override allowed models

---

**Last Updated:** November 21, 2025  
**Jan Version:** Development build with Router extension
