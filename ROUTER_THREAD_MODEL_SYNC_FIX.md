# Router Fix: Thread Model Sync Issue

## Problem Description

**Error:** "No active session found for model: gemma-3n-E4B-it-IQ4_XS"

**Symptom:** The router would select one model (e.g., Qwen), but the error message would reference a different model (e.g., gemma). This indicated a critical mismatch between:
1. The model the router selected
2. The model that was actually used for inference

## Root Cause

The issue was in the routing flow in `web-app/src/hooks/useChat.ts`:

```typescript
// Router selects a model
if (routedModel) {
  selectedModel = routedModel.model        // ✅ Updated
  targetProvider = routedModel.provider    // ✅ Updated
  activeProvider = getProviderByName(...)  // ✅ Updated
  
  // ❌ MISSING: activeThread.model was NOT updated!
}

// Later...
await serviceHub.models().startModel(activeProvider!, selectedModel.id)  // ✅ Correct model started

// Even later in sendCompletion()...
if (!thread?.model?.id || !provider) return undefined  // ❌ Uses OLD thread.model, not the routed one!
```

**The Problem Flow:**
1. Router selects Model A (e.g., Qwen)
2. Code updates `selectedModel` and starts Model A ✅
3. BUT `activeThread.model` still has the OLD model (e.g., gemma) ❌
4. `sendCompletion()` uses `thread.model.id` → tries to use Model B (gemma) ❌
5. Model B not loaded → "No active session found for model: gemma" ❌

**Why This Happened:**
- The routing code updated local variables (`selectedModel`, `targetProvider`)
- BUT it forgot to update the thread object itself
- `sendCompletion()` doesn't use `selectedModel` - it uses `thread.model`
- This created a disconnect between what was loaded and what was used

## Solution

### Fix #1: Update Thread Model After Routing

**File:** `web-app/src/hooks/useChat.ts`

```typescript
if (routedModel) {
  selectedModel = routedModel.model
  targetProvider = routedModel.provider
  activeProvider = getProviderByName(targetProvider)
  
  // ✅ CRITICAL FIX: Update thread.model to match routed model
  activeThread.model = {
    id: selectedModel.id,
    provider: targetProvider,
  }
  
  console.log('[Router] Routed to model:', selectedModel.id)
  console.log('[Router] Updated thread.model to:', activeThread.model?.id)
  
  // ... rest of code
}
```

**Why This Works:**
- `activeThread.model` now matches the routed model
- When `sendCompletion(activeThread, ...)` is called, `thread.model.id` is correct
- The model that was loaded (via `startModel`) matches the model used for inference

### Fix #2: Better Error Handling for Model Loading

**File:** `web-app/src/hooks/useChat.ts`

```typescript
try {
  if (selectedModel?.id) {
    updateLoadingModel(true)
    try {
      await serviceHub.models().startModel(activeProvider!, selectedModel.id)
      console.log('[Router] Model started successfully:', selectedModel.id)
    } catch (modelLoadError) {
      console.error('[Router] Failed to start model:', selectedModel.id, modelLoadError)
      toast.error(`Failed to load model: ${selectedModel.id}`, {
        description: modelLoadError instanceof Error ? modelLoadError.message : String(modelLoadError)
      })
      updateLoadingModel(false)
      return  // ← Abort if model loading fails
    }
    updateLoadingModel(false)
    // Refresh active models list
    serviceHub.models().getActiveModels().then((models) => setActiveModels(models || []))
  }
  // ... continue with chat
```

**Benefits:**
- If model loading fails, we abort gracefully
- User gets a clear error message
- Prevents downstream "No active session" errors

## Complete Fixed Flow

### Before Fix (Broken)
```
1. Router selects Qwen ✅
2. selectedModel = Qwen ✅
3. activeThread.model = gemma (old value) ❌
4. startModel(Qwen) ✅
5. sendCompletion(thread) → uses thread.model.id (gemma) ❌
6. ERROR: "No active session found for model: gemma" ❌
```

### After Fix (Working)
```
1. Router selects Qwen ✅
2. selectedModel = Qwen ✅
3. activeThread.model = Qwen ✅ (NOW UPDATED!)
4. startModel(Qwen) ✅
5. sendCompletion(thread) → uses thread.model.id (Qwen) ✅
6. Success! Uses loaded Qwen model ✅
```

## Testing Verification

### Test Case 1: Simple Routing
```
Setup:
- No models loaded
- Allowed models: Qwen, gemma
- Enable auto-router

Action:
- Send message: "Write a Python function"

Expected Result:
✅ Router selects Qwen (code capability)
✅ Loads Qwen
✅ thread.model.id = "Qwen3-VL-8B-Instruct-IQ4_XS"
✅ Uses Qwen for inference
✅ No errors
```

### Test Case 2: Model Already Loaded
```
Setup:
- Qwen loaded
- Allowed models: Qwen, gemma
- Enable auto-router

Action:
- Send message: "Explain quantum physics"

Expected Result:
✅ Router selects Qwen (already loaded)
✅ No loading delay
✅ thread.model.id = "Qwen3-VL-8B-Instruct-IQ4_XS"
✅ Uses Qwen for inference
✅ No errors
```

### Test Case 3: Better Model Not Loaded
```
Setup:
- Qwen loaded (code)
- gemma not loaded (vision)
- Allowed models: Qwen, gemma
- Enable auto-router

Action:
- Send message with image: "Describe this image"

Expected Result:
✅ Router selects gemma (vision capability)
✅ Loads gemma automatically
✅ thread.model.id = "gemma-3n-E4B-it-IQ4_XS"
✅ Uses gemma for inference
✅ No errors
```

### Test Case 4: Model Load Failure
```
Setup:
- No models loaded
- Model file corrupted/missing
- Enable auto-router

Action:
- Send message

Expected Result:
✅ Router selects model
✅ Attempts to load
❌ Loading fails with error
✅ User sees: "Failed to load model: X"
✅ Chat request aborted (no "No active session" error)
```

## Console Logs Reference

### Successful Routing (After Fix)
```
[Router] Routing query with 2 available models
[Router] Active models: []
[RouterExtension] Available: 2 models (0 loaded, 2 unloaded)
[RouterExtension] Routed to Qwen3-VL-8B-Instruct-IQ4_XS (7ms) - Selected because: query involves coding [will be loaded]
[Router] Routed to model: Qwen3-VL-8B-Instruct-IQ4_XS provider: llamacpp
[Router] Updated thread.model to: Qwen3-VL-8B-Instruct-IQ4_XS  ← CRITICAL LOG
[Router] Model loaded: false
Toast: "Auto Router selected Qwen3-VL-8B-Instruct-IQ4_XS. Loading model..."
[Router] Model started successfully: Qwen3-VL-8B-Instruct-IQ4_XS
[sendCompletion] Using model: Qwen3-VL-8B-Instruct-IQ4_XS  ← MATCHES!
✅ Success!
```

### Before Fix (Broken - showing mismatch)
```
[Router] Routed to model: Qwen3-VL-8B-Instruct-IQ4_XS provider: llamacpp
[Router] Model loaded: false
Toast: "Auto Router selected Qwen3-VL-8B-Instruct-IQ4_XS. Loading model..."
[Model] Started: Qwen3-VL-8B-Instruct-IQ4_XS
[sendCompletion] Using model: gemma-3n-E4B-it-IQ4_XS  ← MISMATCH!
❌ ERROR: No active session found for model: gemma-3n-E4B-it-IQ4_XS
```

## Technical Details

### Thread Model Type
```typescript
// web-app/src/types/threads.d.ts
type ThreadModel = {
  id: string      // Model ID (e.g., "Qwen3-VL-8B-Instruct-IQ4_XS")
  provider: string // Provider ID (e.g., "llamacpp")
}

type Thread = {
  id: string
  title: string
  model?: ThreadModel  // ← This is what sendCompletion uses!
  // ... other fields
}
```

### sendCompletion Flow
```typescript
// web-app/src/lib/completion.ts
export const sendCompletion = async (
  thread: Thread,  // ← Receives thread object
  provider: ModelProvider,
  messages: ChatCompletionMessageParam[],
  // ...
) => {
  if (!thread?.model?.id || !provider) return undefined  // ← Uses thread.model.id
  
  // Later...
  const completion = await tokenJS.chat.completions.create({
    model: thread.model.id,  // ← Model ID from thread!
    // ...
  })
}
```

## Impact

### Before Fix
- ❌ Router could select Model A, but Model B would be used
- ❌ Confusing "No active session" errors
- ❌ Unpredictable behavior
- ❌ Auto-router unusable in practice

### After Fix
- ✅ Router selection is always used
- ✅ No model mismatches
- ✅ Clear error messages if loading fails
- ✅ Auto-router fully functional
- ✅ Predictable, reliable behavior

## Files Modified

1. **`web-app/src/hooks/useChat.ts`**
   - Added `activeThread.model` update after routing decision
   - Added better error handling for model loading
   - Added console logs for debugging

## Related Issues

This fix resolves:
- "No active session found for model: X" when router selected different model
- Model mismatch between routing decision and actual inference
- Confusing error messages that didn't match router selection

## Prevention

To prevent similar issues in the future:
1. **Always sync thread.model with routing decisions**
2. **Log both thread.model and selectedModel** for debugging
3. **Test routing with console logs enabled** to catch mismatches
4. **Add assertions** to verify thread.model matches selectedModel before inference

---

**Last Updated:** November 21, 2025  
**Issue:** Thread model not synced with router selection  
**Status:** ✅ FIXED
