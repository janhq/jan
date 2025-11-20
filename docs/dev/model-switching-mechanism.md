# Model Switching Mechanism in Jan

This document provides a comprehensive overview of how Jan handles switching between different AI models during runtime, including automatic unloading, manual switching, and the underlying infrastructure.

## Table of Contents

1. [Overview](#overview)
2. [Auto-Unload Mechanism](#auto-unload-mechanism)
3. [Manual Model Switching](#manual-model-switching)
4. [Model Loading Flow](#model-loading-flow)
5. [State Management](#state-management)
6. [User Interface Integration](#user-interface-integration)
7. [Edge Cases and Handling](#edge-cases-and-handling)
8. [Performance Considerations](#performance-considerations)
9. [Configuration Options](#configuration-options)

---

## Overview

### Current Implementation

Jan implements a **semi-automatic model switching system** with the following capabilities:

1. **Automatic Unloading**: When enabled, automatically unloads the previous model before loading a new one
2. **Manual Model Selection**: Users can switch models via UI (ModelCombobox)
3. **Model Detection**: Tracks which models are currently loaded (active)
4. **Graceful Switching**: Handles model transitions without losing conversation context
5. **Memory Management**: Ensures only necessary models remain in memory

### Key Design Principle

**One active model at a time** (by default) - This prevents memory exhaustion and ensures optimal performance on consumer hardware.

---

## Auto-Unload Mechanism

### Configuration

**Location**: `extensions/llamacpp-extension/settings.json`

```json
{
  "key": "auto_unload",
  "title": "Auto-Unload Old Models",
  "description": "Automatically unloads models that are not in use to free up memory. Ensure only one model is loaded at a time.",
  "controllerType": "checkbox",
  "controllerProps": { "value": true }
}
```

**Default**: `true` (enabled)

### Implementation

**File**: `extensions/llamacpp-extension/src/index.ts`

#### Core Variables

```typescript
class LlamacppExtension extends AIEngine {
  private autoUnload: boolean = true
  private loadingModels: Map<string, Promise<SessionInfo>> = new Map()
  
  async onLoad() {
    // Read configuration
    this.autoUnload = this.config.auto_unload
  }
}
```

#### Auto-Unload Logic

```typescript
override async load(
  modelId: string,
  overrideSettings?: Partial<LlamacppConfig>,
  isEmbedding: boolean = false
): Promise<SessionInfo> {
  const sInfo = await this.findSessionByModel(modelId)
  if (sInfo) {
    throw new Error('Model already loaded!!')
  }

  // If this model is already being loaded, return the existing promise
  if (this.loadingModels.has(modelId)) {
    return this.loadingModels.get(modelId)!
  }

  // Create the loading promise
  const loadingPromise = this.performLoad(modelId, overrideSettings, isEmbedding)
  this.loadingModels.set(modelId, loadingPromise)

  try {
    const result = await loadingPromise
    return result
  } finally {
    this.loadingModels.delete(modelId)
  }
}

private async performLoad(
  modelId: string,
  overrideSettings?: Partial<LlamacppConfig>,
  isEmbedding: boolean = false
): Promise<SessionInfo> {
  const loadedModels = await this.getLoadedModels()

  // Get OTHER models that are currently loading (exclude current model)
  const otherLoadingPromises = Array.from(this.loadingModels.entries())
    .filter(([id, _]) => id !== modelId)
    .map(([_, promise]) => promise)

  if (
    this.autoUnload &&
    !isEmbedding &&
    (loadedModels.length > 0 || otherLoadingPromises.length > 0)
  ) {
    // Wait for OTHER loading models to finish, then unload everything
    if (otherLoadingPromises.length > 0) {
      await Promise.all(otherLoadingPromises)
    }

    // Now unload all loaded Text models excluding embedding models
    const allLoadedModels = await this.getLoadedModels()
    if (allLoadedModels.length > 0) {
      const sessionInfos: (SessionInfo | null)[] = await Promise.all(
        allLoadedModels.map(async (modelId) => {
          try {
            return await this.findSessionByModel(modelId)
          } catch (e) {
            logger.warn(`Unable to find session for model "${modelId}": ${e}`)
            return null // treat as "not‑eligible for unload"
          }
        })
      )

      const nonEmbeddingModels: string[] = sessionInfos
        .filter(
          (s): s is SessionInfo => s !== null && s.is_embedding === false
        )
        .map((s) => s.model_id)

      if (nonEmbeddingModels.length > 0) {
        await Promise.all(
          nonEmbeddingModels.map((modelId) => this.unload(modelId))
        )
      }
    }
  }
  
  // Continue with model loading...
  // (spawn llama-server process, configure, etc.)
}
```

### Auto-Unload Flow Diagram

```
User requests to load Model B
    ↓
Check if auto_unload is enabled
    ↓
    ├─ No → Load Model B directly (multiple models can coexist)
    │
    └─ Yes → Continue ↓
    
Check if Model B is already loaded
    ↓
    ├─ Yes → Throw error "Model already loaded!!"
    │
    └─ No → Continue ↓
    
Check if Model B is currently being loaded
    ↓
    ├─ Yes → Return existing loading promise
    │
    └─ No → Continue ↓
    
Get list of currently loaded models (Model A)
    ↓
Check if other models are currently loading
    ↓
    ├─ Yes → Wait for them to finish
    │
    └─ No → Continue ↓
    
Filter loaded models (exclude embedding models)
    ↓
Unload all non-embedding models in parallel
    ↓
    ├─ Model A → unload(Model A)
    ├─ Model C → unload(Model C)
    └─ ...
    ↓
All previous models unloaded
    ↓
Spawn new llama-server process for Model B
    ↓
Configure Model B (args, settings, port, etc.)
    ↓
Model B ready
    ↓
Return SessionInfo for Model B
```

### Why Preserve Embedding Models?

**Embedding models** (used for RAG/document search) are kept loaded because:
1. **Small memory footprint**: Typically ~500MB-1GB
2. **Frequent use**: Needed for every RAG query
3. **Fast reloading not guaranteed**: May slow down document search
4. **No conflict**: Don't interfere with chat models

---

## Manual Model Switching

### User Triggers

#### 1. **ModelCombobox Selection**

**File**: `web-app/src/containers/ModelCombobox.tsx`

```typescript
const handleModelSelect = useCallback(
  (modelId: string) => {
    // Find provider and model
    const provider = providers.find(p => 
      p.models.some(m => m.id === modelId)
    )
    
    if (provider) {
      const model = provider.models.find(m => m.id === modelId)
      
      // Update global state
      selectModelProvider(provider.provider, modelId)
      
      // Trigger model loading if needed
      // (happens automatically on next message send)
    }
  },
  [providers, selectModelProvider]
)
```

#### 2. **Restart Model** (Settings Change)

**File**: `web-app/src/hooks/useChat.ts`

```typescript
const restartModel = useCallback(
  async (provider: ProviderObject, modelId: string) => {
    // Stop all currently running models
    await serviceHub.models().stopAllModels()
    
    // Set loading state
    updateLoadingModel(true)
    
    // Start the specified model
    await serviceHub
      .models()
      .startModel(provider, modelId)
      .catch(console.error)
    
    // Clear loading state
    updateLoadingModel(false)
    
    // Refresh list of active models
    serviceHub
      .models()
      .getActiveModels()
      .then((models) => setActiveModels(models || []))
  },
  [updateLoadingModel, serviceHub]
)
```

**Use Cases for Restart**:
- User changed model settings (context size, GPU layers, etc.)
- User enabled context shift
- User increased context window size

### Model Switching Flow (Manual)

```
User selects Model B from dropdown
    ↓
ModelCombobox.handleModelSelect()
    ↓
Update Zustand state:
  - selectedProvider: 'llamacpp'
  - selectedModel: { id: 'model-b', ... }
    ↓
User sends a message
    ↓
useChat.sendMessage()
    ↓
Check if selected model is loaded
    ↓
    ├─ Yes → Use existing session
    │
    └─ No → Load model ↓
    
serviceHub.models().startModel(provider, modelId)
    ↓
AIEngine.load(modelId, settings)
    ↓
If auto_unload enabled:
  - Unload Model A (previous model)
    ↓
Spawn llama-server for Model B
    ↓
Model B ready
    ↓
Send completion request to Model B
    ↓
Stream response back to UI
```

---

## Model Loading Flow

### Service Layer

**File**: `web-app/src/services/models/default.ts`

```typescript
export class DefaultModelsService implements ModelsService {
  async startModel(
    provider: ProviderObject,
    model: string
  ): Promise<SessionInfo | undefined> {
    const engine = this.getEngine(provider.provider)
    if (!engine) return undefined

    // Check if model is already loaded
    const loadedModels = await engine.getLoadedModels()
    if (loadedModels.includes(model)) return undefined

    // Find the model configuration to get settings
    const modelConfig = provider.models.find((m) => m.id === model)

    // Key mapping function to transform setting keys
    const mapSettingKey = (key: string): string => {
      const keyMappings: Record<string, string> = {
        ctx_len: 'ctx_size',
        ngl: 'n_gpu_layers',
      }
      return keyMappings[key] || key
    }

    // Extract settings from model config
    const settings = modelConfig?.settings
      ? Object.fromEntries(
          Object.entries(modelConfig.settings).map(([key, value]) => [
            mapSettingKey(key),
            value.controller_props?.value,
          ])
        )
      : undefined

    // Load the model via engine
    return engine.load(model, settings).catch((error) => {
      console.error(
        `Failed to start model ${model} for provider ${provider.provider}:`,
        error
      )
      throw error
    })
  }

  async stopModel(
    model: string,
    provider?: string
  ): Promise<UnloadResult | undefined> {
    return this.getEngine(provider)?.unload(model)
  }

  async stopAllModels(): Promise<void> {
    const models = await this.getActiveModels()
    if (models) await Promise.all(models.map((model) => this.stopModel(model)))
  }

  async getActiveModels(provider?: string): Promise<string[]> {
    return this.getEngine(provider)?.getLoadedModels() ?? []
  }
}
```

### Backend (Rust/Tauri)

**File**: `src-tauri/plugins/tauri-plugin-llamacpp/src/commands.rs`

#### Unload Model Command

```rust
/// Unload a llama model by terminating its process
#[tauri::command]
pub async fn unload_llama_model<R: Runtime>(
    app: AppHandle<R>,
    pid: u32,
) -> Result<UnloadResult, String> {
    let state = app.state::<AppState>();
    let mut sessions = state.sessions.lock().await;
    
    // Find session by PID
    if let Some(index) = sessions.iter().position(|s| s.pid == pid) {
        let session = sessions.remove(index);
        
        // Terminate llama-server process
        if let Some(mut child) = session.child {
            match child.kill() {
                Ok(_) => {
                    info!("Successfully terminated llama-server process (PID: {})", pid);
                    Ok(UnloadResult {
                        success: true,
                        error: None,
                    })
                }
                Err(e) => {
                    error!("Failed to terminate process {}: {}", pid, e);
                    Ok(UnloadResult {
                        success: false,
                        error: Some(format!("Failed to kill process: {}", e)),
                    })
                }
            }
        } else {
            warn!("No child process found for PID: {}", pid);
            Ok(UnloadResult {
                success: true,
                error: None,
            })
        }
    } else {
        warn!("No session found for PID: {}", pid);
        Ok(UnloadResult {
            success: false,
            error: Some(format!("No session found for PID {}", pid)),
        })
    }
}
```

### Extension Unload Method

**File**: `extensions/llamacpp-extension/src/index.ts`

```typescript
override async unload(modelId: string): Promise<UnloadResult> {
  const sessionInfo = await this.findSessionByModel(modelId)
  
  if (sessionInfo) {
    const pid = sessionInfo.pid
    try {
      const result = await unloadLlamaModel(pid)
      
      if (result.success) {
        logger.info(`Successfully unloaded model with PID ${pid}`)
      } else {
        logger.warn(`Failed to unload model: ${result.error}`)
      }
      
      return result
    } catch (error) {
      logger.error(`Error unloading model ${modelId}:`, error)
      return {
        success: false,
        error: `Failed to unload model: ${error}`,
      }
    }
  }
  
  return {
    success: false,
    error: `Model ${modelId} not found in active sessions`,
  }
}
```

---

## State Management

### Active Models Tracking

**File**: `web-app/src/hooks/useAppState.ts`

```typescript
type AppState = {
  activeModels: string[]
  setActiveModels: (models: string[]) => void
}

export const useAppState = create<AppState>()((set) => ({
  activeModels: [],
  setActiveModels: (models: string[]) => {
    set({ activeModels: models })
  },
}))
```

### Model Provider State

**File**: `web-app/src/hooks/useModelProvider.ts`

```typescript
type ModelProviderState = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model | null
  selectModelProvider: (
    providerName: string,
    modelName: string
  ) => Model | undefined
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      selectedProvider: 'llamacpp',
      selectedModel: null,
      
      selectModelProvider: (providerName: string, modelName: string) => {
        // Find the model object
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        let modelObject: Model | undefined = undefined

        if (provider && provider.models) {
          modelObject = provider.models.find((model) => model.id === modelName)
        }

        // Update state with provider name and model object
        set({
          selectedProvider: providerName,
          selectedModel: modelObject || null,
        })

        return modelObject
      },
    }),
    {
      name: 'jan-model-provider',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
```

### Loading State

**File**: `web-app/src/hooks/useModelLoad.ts`

```typescript
type ModelLoadState = {
  modelLoadError?: string | ErrorObject
  setModelLoadError: (error: string | ErrorObject | undefined) => void
}

export const useModelLoad = create<ModelLoadState>()((set) => ({
  modelLoadError: undefined,
  setModelLoadError: (error) => set({ modelLoadError: error }),
}))
```

**File**: `web-app/src/hooks/useAppState.ts`

```typescript
type AppState = {
  loadingModel?: boolean
  updateLoadingModel: (loading: boolean) => void
}

export const useAppState = create<AppState>()((set) => ({
  loadingModel: false,
  updateLoadingModel: (loading) => {
    set({ loadingModel: loading })
  },
}))
```

---

## User Interface Integration

### Model Switch Detection

**File**: `web-app/src/containers/ScrollToBottom.tsx`

Jan detects when a user has switched models mid-conversation and shows appropriate UI:

```typescript
const ScrollToBottom = ({ threadId, scrollContainerRef }) => {
  const messages = useMessages((state) => state.messages[threadId])
  const streamingContent = useAppState((state) => state.streamingContent)
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const updateMessage = useMessages((state) => state.updateMessage)

  // Check if last message is a partial assistant response
  const isPartialResponse =
    messages.length >= 2 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    messages[messages.length - 1]?.status === MessageStatus.Stopped &&
    messages[messages.length - 2]?.role === 'user' &&
    !messages[messages.length - 1]?.metadata?.tool_calls

  // Check if the partial response was generated by a different model
  const partialMessage = messages[messages.length - 1]
  const partialMessageModelId = partialMessage?.metadata?.modelId as string | undefined
  const hasModelSwitchedFlag = partialMessage?.metadata?.modelSwitched === true

  const currentModelMismatch = isPartialResponse &&
    partialMessageModelId !== undefined &&
    partialMessageModelId !== selectedModel?.id

  const isModelMismatch = isPartialResponse && (currentModelMismatch || hasModelSwitchedFlag)

  // Mark the message as "model switched" to prevent repeated detection
  useEffect(() => {
    if (currentModelMismatch && !hasModelSwitchedFlag && partialMessage) {
      updateMessage({
        ...partialMessage,
        metadata: {
          ...partialMessage.metadata,
          modelSwitched: true,
        },
      })
    }
  }, [currentModelMismatch, hasModelSwitchedFlag, partialMessage, updateMessage])

  return (
    <div>
      {isModelMismatch && (
        <GenerateResponseButton 
          threadId={threadId} 
          isModelMismatch={true}  // Shows special message about model switch
        />
      )}
    </div>
  )
}
```

### Model Switch Indicators

When a model switch is detected:

1. **Visual Indicator**: "Continue" button appears with different styling
2. **Tooltip/Message**: Indicates that the conversation was started with a different model
3. **User Action**: User can continue with the new model or regenerate with the original

---

## Edge Cases and Handling

### 1. Model Already Loaded

**Scenario**: User tries to load a model that's already running.

```typescript
override async load(modelId: string, ...): Promise<SessionInfo> {
  const sInfo = await this.findSessionByModel(modelId)
  if (sInfo) {
    throw new Error('Model already loaded!!')
  }
  // Continue loading...
}
```

**Handling**: Throws error, caught by service layer, returns undefined (UI shows no change).

### 2. Concurrent Model Loading

**Scenario**: User rapidly switches between models A → B → C.

```typescript
private loadingModels: Map<string, Promise<SessionInfo>> = new Map()

override async load(modelId: string, ...): Promise<SessionInfo> {
  // If this model is already being loaded, return the existing promise
  if (this.loadingModels.has(modelId)) {
    return this.loadingModels.get(modelId)!
  }

  // Create the loading promise
  const loadingPromise = this.performLoad(modelId, ...)
  this.loadingModels.set(modelId, loadingPromise)

  try {
    const result = await loadingPromise
    return result
  } finally {
    this.loadingModels.delete(modelId)
  }
}
```

**Behavior**:
- Model A starts loading
- User selects Model B → Wait for A to finish, then unload A, load B
- User selects Model C → Wait for B to finish, then unload B, load C

**Result**: Only the final model (C) ends up loaded.

### 3. Model Load Failure

**Scenario**: Model fails to load (insufficient memory, corrupted file, etc.).

```typescript
async startModel(provider, model): Promise<SessionInfo | undefined> {
  return engine.load(model, settings).catch((error) => {
    console.error(`Failed to start model ${model}:`, error)
    throw error  // Propagates to UI
  })
}
```

**Frontend Handling** (`useChat.ts`):

```typescript
const setModelLoadError = useModelLoad((state) => state.setModelLoadError)

try {
  await loadModel(modelId, provider)
} catch (error) {
  setModelLoadError(error)
  // UI shows error dialog
}
```

### 4. Mid-Conversation Switch

**Scenario**: User switches models while actively chatting.

```typescript
// Message metadata tracks which model generated it
const message: ThreadMessage = {
  role: 'assistant',
  content: '...',
  metadata: {
    modelId: 'llama-3-8b',  // Track source model
    ...
  }
}
```

**Detection** (shown earlier):
- Compare `partialMessage.metadata.modelId` with `selectedModel.id`
- If mismatch → Show "model switched" indicator
- User can regenerate with new model or continue

### 5. Embedding Model Preservation

**Scenario**: User loads RAG model (embedding) while chat model is active.

```typescript
if (
  this.autoUnload &&
  !isEmbedding &&  // ← Only unload if NEW model is NOT embedding
  loadedModels.length > 0
) {
  // Filter: only unload non-embedding models
  const nonEmbeddingModels = sessionInfos
    .filter(s => s !== null && s.is_embedding === false)
    .map(s => s.model_id)

  await Promise.all(
    nonEmbeddingModels.map(modelId => this.unload(modelId))
  )
}
```

**Behavior**: Chat model unloaded, embedding model preserved.

---

## Performance Considerations

### 1. Memory Management

**Auto-Unload Benefits**:
- Frees VRAM/RAM immediately after switching
- Prevents OOM errors on consumer hardware
- Typical savings: 4-8GB per model

**Trade-off**:
- Switching latency: ~5-30 seconds (model load time)
- If auto-unload disabled: Multiple models can coexist (if memory allows)

### 2. Model Load Optimization

**Strategies**:
1. **Preload on Selection**: Could start loading model when user hovers over dropdown (speculative)
2. **Keep Settings Cached**: Avoid re-parsing model config on each load
3. **Parallel Unload**: Unload old model while spawning new llama-server process (risky, but faster)

**Current Approach**: Sequential (safe, predictable).

### 3. Process Management

Each model runs as a **separate llama-server process**:

```
Model A → llama-server (PID 12345, Port 1234)
Model B → llama-server (PID 12346, Port 1235)
```

**Benefits**:
- Isolation: Crash in one model doesn't affect others
- Easy cleanup: Kill process to unload
- Port-based routing: Each model has unique endpoint

**Tracking** (`AppState` in Rust):

```rust
pub struct AppState {
    pub sessions: Mutex<Vec<SessionInfo>>,
}

pub struct SessionInfo {
    pub pid: u32,
    pub port: u32,
    pub model_id: String,
    pub model_path: String,
    pub is_embedding: bool,
    pub api_key: String,
}
```

---

## Configuration Options

### User-Configurable Settings

#### 1. Auto-Unload Toggle

**Location**: Settings → Providers → llama.cpp → Auto-Unload Old Models

```json
{
  "key": "auto_unload",
  "title": "Auto-Unload Old Models",
  "description": "Automatically unloads models that are not in use to free up memory. Ensure only one model is loaded at a time.",
  "controllerType": "checkbox",
  "controllerProps": { "value": true }
}
```

**When to Disable**:
- High-memory systems (64GB+ RAM, 24GB+ VRAM)
- Frequently switching between 2-3 models
- Want to compare model responses side-by-side

**When to Enable** (default):
- Consumer hardware (16GB RAM, 8GB VRAM)
- Running large models (70B, 30B)
- Memory is constrained

#### 2. Model-Specific Settings

Each model can have custom settings that affect loading:

```json
{
  "ctx_len": 4096,          // Context window size
  "n_gpu_layers": 35,       // GPU offloading
  "batch_size": 512,
  "flash_attn": "auto",
  "cont_batching": true
}
```

**Effect on Switching**:
- Changes require model restart
- Uses `restartModel()` function (unload + reload with new settings)

---

## Implementation Summary

### Key Components

| Component | Role | Location |
|-----------|------|----------|
| **LlamacppExtension** | Auto-unload logic, model loading | `extensions/llamacpp-extension/src/index.ts` |
| **DefaultModelsService** | Service layer, model start/stop | `web-app/src/services/models/default.ts` |
| **useModelProvider** | Global state for selected model | `web-app/src/hooks/useModelProvider.ts` |
| **useAppState** | Active models tracking, loading state | `web-app/src/hooks/useAppState.ts` |
| **ScrollToBottom** | Model switch detection in UI | `web-app/src/containers/ScrollToBottom.tsx` |
| **Tauri Commands** | Backend process management | `src-tauri/plugins/tauri-plugin-llamacpp/src/commands.rs` |

### Data Flow

```
User selects Model B
    ↓
ModelCombobox → useModelProvider.selectModelProvider()
    ↓
Update state: selectedModel = Model B
    ↓
User sends message
    ↓
useChat.sendMessage() → Check if Model B loaded
    ↓
    No → serviceHub.models().startModel()
    ↓
DefaultModelsService.startModel()
    ↓
AIEngine.load(modelId, settings)
    ↓
LlamacppExtension.load()
    ↓
If auto_unload:
  ├─ Get loaded models (Model A)
  ├─ Filter non-embedding models
  └─ Unload Model A in parallel
    ↓
Spawn llama-server for Model B
    ↓
Track session in Rust AppState
    ↓
Return SessionInfo
    ↓
Update activeModels state
    ↓
Ready for inference
```

### Automatic vs Manual Switching

| Aspect | Automatic (Auto-Unload) | Manual |
|--------|-------------------------|--------|
| **Trigger** | Loading new model | User calls `restartModel()` or `stopAllModels()` |
| **Target** | Previous model(s) | All models or specific model |
| **Timing** | Before loading new model | On-demand |
| **Embedding Models** | Preserved | Can be stopped if requested |
| **Use Case** | Normal operation | Settings change, memory cleanup |

---

## Future Enhancements

### Potential Improvements

1. **Smart Pre-loading**:
   - Predict next model user might select
   - Pre-load in background during idle time
   - Reduces perceived switching latency

2. **Model Pooling**:
   - Keep 2-3 most recently used models loaded (if memory allows)
   - LRU eviction when memory pressure detected
   - Configurable pool size

3. **Graceful Degradation**:
   - If new model fails to load, auto-rollback to previous model
   - Preserve conversation continuity

4. **Multi-Model Conversations**:
   - Allow different models for different messages in same thread
   - Track which model generated each response
   - UI shows model name per message

5. **Hardware-Aware Auto-Unload**:
   - Detect available VRAM/RAM
   - Dynamically enable/disable auto-unload based on resources
   - Smart: "You can fit 2 models, auto-unload disabled"

6. **Session Persistence**:
   - Save loaded model state across app restarts
   - Quick resume without full reload

---

## Debugging and Monitoring

### Logging

**Extension Logs** (`extensions/llamacpp-extension/src/index.ts`):

```typescript
logger.info(`Successfully unloaded model with PID ${pid}`)
logger.warn(`Failed to unload model: ${result.error}`)
logger.error(`Error unloading model ${modelId}:`, error)
```

**Service Logs** (`web-app/src/services/models/default.ts`):

```typescript
console.error(`Failed to start model ${model}:`, error)
```

### State Inspection

**Browser Console**:

```javascript
// Check currently selected model
useModelProvider.getState().selectedModel

// Check active models
useAppState.getState().activeModels

// Check loading state
useAppState.getState().loadingModel

// Check all providers
useModelProvider.getState().providers
```

### Tauri DevTools

**Check Rust State**:

```rust
// In Tauri app state
let sessions = app.state::<AppState>().sessions.lock().await;
println!("Active sessions: {:?}", sessions);
```

---

## Conclusion

Jan's model switching mechanism provides:

✅ **Automatic Memory Management**: Auto-unload prevents memory exhaustion  
✅ **User Control**: Manual override via settings and UI  
✅ **Graceful Handling**: Detects mid-conversation switches  
✅ **Embedding Preservation**: Smart filtering keeps utility models loaded  
✅ **Robust State Tracking**: Multiple layers ensure consistency  
✅ **Performance**: Process-based isolation and efficient cleanup  

The current implementation strikes a balance between **ease of use** (automatic) and **flexibility** (configurable), making Jan accessible to both casual users and power users.
