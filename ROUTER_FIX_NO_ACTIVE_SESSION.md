# Router Enhancement: Automatic Model Loading

## Problem Description (RESOLVED)

Users were experiencing the error:
```
No active session found for model: gemma-3n-E4B-it-IQ4_XS
```

This occurred when using the auto-routing feature, even though the router successfully selected a model. The issue was that the router was selecting models that weren't actually loaded/running.

**UPDATE (November 21, 2025):** The router has been enhanced to automatically load models that aren't currently loaded. This makes the auto-router truly autonomous and intelligent.

## Root Cause Analysis

### Issue #1: Missing Active Model Information
**Location:** `web-app/src/hooks/useChat.ts:743`

```typescript
// BEFORE (BROKEN)
activeModels: [], // TODO: Get actual active models
```

The routing context was being passed an empty array for `activeModels`, so the router had no information about which models were actually loaded and ready to use.

### Issue #2: All Models Marked as Not Loaded
**Location:** `web-app/src/hooks/useChat.ts:107`

```typescript
// BEFORE (BROKEN)
const buildAvailableModels = (providers: ModelProvider[]): AvailableModel[] => {
  // ...
  availableModels.push({
    // ...
    metadata: {
      // ...
      isLoaded: false, // ← Always false!
    },
  })
}
```

The `buildAvailableModels` function was hardcoding `isLoaded: false` for all models, regardless of their actual state.

### Issue #3: Insufficient Preference for Loaded Models
**Location:** `extensions/router-extension/src/strategies/HeuristicRouter.ts:106`

```typescript
// BEFORE (WEAK)
if (activeModels.includes(model.id)) {
  score += 20  // ← Only +20 bonus
}
```

The HeuristicRouter only gave a +20 bonus to loaded models, which could easily be overridden by other factors (capability matching +30-40, etc.), causing it to select unloaded models.

### Issue #4: No Enforcement of Loaded Models Only
**Location:** `extensions/router-extension/src/index.ts:93`

The router would route to ANY model in the allowed list, even if none were loaded. This caused the "No active session" error when trying to use an unloaded model.

## Solution Implemented

### Fix #1: Pass Actual Active Models to Router
**File:** `web-app/src/hooks/useChat.ts`

```typescript
// AFTER (FIXED)
const activeModelIds = useAppState.getState().activeModels
const availableModels = buildAvailableModels(providers, activeModelIds)

// ...

const routeDecision = await router.route({
  messages: routingMessages,
  threadId: activeThread.id,
  availableModels,
  activeModels: activeModelIds,  // ← Now populated with actual loaded model IDs
  attachments: { /* ... */ },
})
```

### Fix #2: Correctly Mark Loaded Models
**File:** `web-app/src/hooks/useChat.ts`

```typescript
// AFTER (FIXED)
const buildAvailableModels = (
  providers: ModelProvider[],
  activeModelIds: string[] = []  // ← New parameter
): AvailableModel[] => {
  // ...
  availableModels.push({
    // ...
    metadata: {
      // ...
      isLoaded: activeModelIds.includes(model.id),  // ← Check actual state
    },
  })
}
```

### Fix #3: Strong Preference for Loaded Models
**File:** `extensions/router-extension/src/strategies/HeuristicRouter.ts`

```typescript
// AFTER (FIXED)
// 4. Already loaded bonus (CRITICAL - avoid model switching and ensure usability)
if (model.metadata.isLoaded) {
  score += 50  // ← Strong +50 bonus to prevent "No active session" errors
}

// Also check activeModels array for backwards compatibility
if (activeModels.includes(model.id)) {
  score += 20
}
```

Now loaded models get a **+70 total bonus** (+50 for `isLoaded` + +20 for being in `activeModels`), making them heavily favored.

### Fix #4: Route Only to Loaded Models
**File:** `extensions/router-extension/src/index.ts`

```typescript
// AFTER (FIXED)
async route(context: RouteContext): Promise<RouteDecision> {
  // First, filter by allowed models
  let filteredModels = this.filterAllowedModels(context.availableModels)

  // Then, prioritize loaded models - if any loaded models exist, only use those
  const loadedModels = filteredModels.filter(m => m.metadata.isLoaded)
  
  if (loadedModels.length > 0) {
    console.log(`[RouterExtension] ${loadedModels.length} loaded models found, routing only to loaded models`)
    filteredModels = loadedModels  // ← Only route to loaded models!
  } else {
    console.warn('[RouterExtension] No loaded models found - this may cause errors')
    console.warn('[RouterExtension] Please load at least one allowed model:', this.allowedModels)
  }

  if (filteredModels.length === 0) {
    throw new Error('No suitable models available for routing. Please load at least one allowed model.')
  }

  const decision = await this.activeStrategy.route({
    ...context,
    availableModels: filteredModels,
  })
  
  return decision
}
```

**Key improvement:** If ANY loaded models are found in the allowed list, the router will ONLY consider those loaded models, completely ignoring unloaded ones.

---

## Enhancement: Automatic Model Loading (November 21, 2025)

### The Evolution

The initial fix prevented "No active session" errors by only routing to loaded models. However, this was too restrictive - users requested the ability for the router to load models automatically.

### New Behavior: Intelligent + Autonomous

The router now operates in two modes based on what's available:

**Mode 1: Optimize for Speed (Loaded Models Available)**
- If loaded models can handle the task, use them (instant response)
- Strong +50 bonus to loaded models in scoring
- Avoids unnecessary model switching

**Mode 2: Optimize for Quality (Best Model Not Loaded)**
- Router selects the BEST model for the task, loaded or not
- Automatically loads the selected model
- User gets clear feedback: "Loading model..."
- Seamless experience - no manual intervention needed

### Implementation of Auto-Loading

**File:** `extensions/router-extension/src/index.ts`

```typescript
// NEW (ENHANCED)
async route(context: RouteContext): Promise<RouteDecision> {
  console.log(`[RouterExtension] Routing with strategy: ${this.activeStrategy.name}`)

  // Filter by allowed models
  const filteredModels = this.filterAllowedModels(context.availableModels)

  // Check loaded vs unloaded models
  const loadedModels = filteredModels.filter(m => m.metadata.isLoaded)
  const unloadedModels = filteredModels.filter(m => !m.metadata.isLoaded)
  
  console.log(`[RouterExtension] Available: ${filteredModels.length} models (${loadedModels.length} loaded, ${unloadedModels.length} unloaded)`)
  
  // Note: We now allow routing to unloaded models - they will be loaded automatically
  // The HeuristicRouter gives strong preference (+50) to loaded models to minimize loading time

  const decision = await this.activeStrategy.route({
    ...context,
    availableModels: filteredModels, // ← All allowed models, loaded or not!
  })

  // Check if selected model needs loading
  const selectedModel = filteredModels.find(m => m.id === decision.modelId)
  const needsLoading = selectedModel && !selectedModel.metadata.isLoaded

  console.log(
    `[RouterExtension] Routed to ${decision.modelId} - ${decision.reasoning}${needsLoading ? ' [will be loaded]' : ' [already loaded]'}`
  )

  return decision
}
```

**File:** `web-app/src/hooks/useChat.ts`

```typescript
// Check if model is already loaded and provide feedback
const isModelLoaded = activeModelIds.includes(selectedModel.id)

console.log('[Router] Model loaded:', isModelLoaded)

if (!isModelLoaded) {
  toast.success(`Auto Router selected ${selectedModel.id}. Loading model...`)
} else {
  toast.success(`Auto Router selected ${selectedModel.id}`)
}

// Later in the code (line 802):
if (selectedModel?.id) {
  updateLoadingModel(true)
  await serviceHub.models().startModel(activeProvider!, selectedModel.id) // ← Loads if not loaded!
  updateLoadingModel(false)
  // Refresh active models list
  serviceHub.models().getActiveModels().then((models) => setActiveModels(models || []))
}
```

### Why This Works

1. **Smart Preference System**: Loaded models get +50 bonus, so they're preferred when suitable
2. **Quality Over Speed**: If the best model for the task isn't loaded, router chooses quality
3. **Existing Infrastructure**: `startModel()` already handles loading - we just removed the restriction
4. **Clear Feedback**: Users see when a model is being loaded vs using an already-loaded model

### Example: Vision Query with Code Model Loaded

```
Available: Qwen3-VL-8B-Instruct-IQ4_XS (code), gemma-3n-E4B-it-IQ4_XS (vision)
Loaded: Qwen3-VL-8B-Instruct-IQ4_XS
Query: "Describe this image" + [image.jpg]

OLD Behavior (Restrictive):
❌ Routes to Qwen (loaded) → Poor result (no vision capability)

NEW Behavior (Intelligent):
✅ Routes to gemma-3n-E4B-it-IQ4_XS (vision capability)
✅ Automatically loads gemma
✅ User sees: "Auto Router selected gemma-3n-E4B-it-IQ4_XS. Loading model..."
✅ Perfect result - right tool for the job!
```

## Behavior After Fix

### Scenario 1: Best Model Already Loaded ⚡
```
Allowed Models: [Qwen3-VL-8B-Instruct-IQ4_XS, gemma-3n-E4B-it-IQ4_XS]
Loaded Models:  [Qwen3-VL-8B-Instruct-IQ4_XS]
Query: "Write a Python function to sort a list"

Router Action:
✅ Routes to: Qwen3-VL-8B-Instruct-IQ4_XS (loaded, has code capability)
✅ No loading delay - instant response
✅ Toast: "Auto Router selected Qwen3-VL-8B-Instruct-IQ4_XS"
```

### Scenario 2: Better Model Not Loaded 🚀 (NEW!)
```
Allowed Models: [Qwen3-VL-8B-Instruct-IQ4_XS, gemma-3n-E4B-it-IQ4_XS]
Loaded Models:  [Qwen3-VL-8B-Instruct-IQ4_XS]
Query: "Analyze this image" (with image attachment)

Router Action:
✅ Routes to: gemma-3n-E4B-it-IQ4_XS (has vision capability, not loaded)
✅ Automatically loads gemma-3n-E4B-it-IQ4_XS
✅ Toast: "Auto Router selected gemma-3n-E4B-it-IQ4_XS. Loading model..."
✅ Processes query after loading completes
⚡ Smart: Qwen is loaded, but gemma is BETTER for vision tasks
```

### Scenario 3: No Loaded Models - Selects Best
```
Allowed Models: [Qwen3-VL-8B-Instruct-IQ4_XS, gemma-3n-E4B-it-IQ4_XS]
Loaded Models:  []
Query: "Explain quantum physics"

Router Action:
✅ Routes to: Qwen3-VL-8B-Instruct-IQ4_XS (best match for reasoning)
✅ Automatically loads Qwen3-VL-8B-Instruct-IQ4_XS
✅ Toast: "Auto Router selected Qwen3-VL-8B-Instruct-IQ4_XS. Loading model..."
✅ No manual intervention needed!
```

### Scenario 4: No Allowed Models Available
```
Allowed Models: [Qwen3-VL-8B-Instruct-IQ4_XS, gemma-3n-E4B-it-IQ4_XS]
Available Models: [some-other-model-7B]

Router Action:
❌ Error: "No suitable models available for routing. Please check your allowed models configuration."
💡 User needs to either:
   - Add available models to allowed list, OR
   - Download/configure an allowed model
```

## Testing Checklist

- [x] Load a model that's in the allowed list
- [x] Enable auto-routing
- [x] Send a message
- [x] Verify router selects the loaded model
- [x] Verify message completes without "No active session" error
- [ ] Test with multiple loaded allowed models (should route intelligently)
- [ ] Test with no loaded models (should show clear error)
- [ ] Test with loaded model not in allowed list (should show clear error)

## Console Logs for Debugging

When routing works correctly, you'll see:

```
[Router] Routing query with 2 available models
[Router] Active models: ["Qwen3-VL-8B-Instruct-IQ4_XS"]
[RouterExtension] Routing with strategy: heuristic
[RouterExtension] 1 loaded models found, routing only to loaded models
[RouterExtension] Routed to Qwen3-VL-8B-Instruct-IQ4_XS (8ms) - Selected Qwen3-VL-8B-Instruct-IQ4_XS because: model already loaded
[Router] Decision: { modelId: "Qwen3-VL-8B-Instruct-IQ4_XS", ... }
[Router] Routed to model: Qwen3-VL-8B-Instruct-IQ4_XS provider: llamacpp
```

When no loaded models are available:

```
[Router] Routing query with 2 available models
[Router] Active models: []
[RouterExtension] Routing with strategy: heuristic
[RouterExtension] No loaded models found - this may cause errors
[RouterExtension] Please load at least one allowed model: Qwen3-VL-8B-Instruct-IQ4_XS,gemma-3n-E4B-it-IQ4_XS
ERROR: No suitable models available for routing. Please load at least one allowed model.
```

## User-Facing Impact

### Before Fix
- ❌ Confusing error: "No active session found for model: X"
- ❌ Unclear what went wrong
- ❌ Router silently selected unusable model

### After Fix
- ✅ Router only selects loaded models
- ✅ Clear error messages if no loaded models
- ✅ Helpful console logs for debugging
- ✅ Prevents "No active session" errors entirely

## Files Changed

1. **`web-app/src/hooks/useChat.ts`**
   - Updated `buildAvailableModels()` to accept and use `activeModelIds`
   - Pass actual active model IDs to router context

2. **`extensions/router-extension/src/index.ts`**
   - Filter to loaded models only (when available)
   - Better error messages
   - Defensive logging

3. **`extensions/router-extension/src/strategies/HeuristicRouter.ts`**
   - Increased loaded model bonus from +20 to +50
   - Added check for `metadata.isLoaded` in addition to `activeModels` array

## Related Documentation

- `ROUTER_ALLOWED_MODELS.md` - Configuration of allowed models
- `ROUTER_IMPLEMENTATION.md` - Overall router architecture
- `ROUTER_TESTING.md` - Testing procedures

---

**Last Updated:** November 21, 2025  
**Issue:** "No active session found" error when using auto-routing  
**Status:** ✅ FIXED
