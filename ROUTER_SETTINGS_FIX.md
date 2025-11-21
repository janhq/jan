# Router Settings Fix - RouterManager Global Access

## Problem
Router settings page showed "Router extension not loaded" even after retry attempts.

## Root Cause
`RouterManager` was not accessible globally via `window.core`, so even though the router extension was loading and registering itself correctly, the settings page couldn't access it reliably.

## Solution Applied

### 1. Added RouterManager to Global Types
**File:** `web-app/src/types/global.d.ts`

Added import and type definition:
```typescript
import type { RouterManager } from '@janhq/core'

type AppCore = {
  api: APIs
  extensionManager: ExtensionManager | undefined
  routerManager?: RouterManager  // ← Added this
}
```

### 2. Initialized RouterManager Globally
**File:** `web-app/src/providers/ExtensionProvider.tsx`

Added RouterManager initialization:
```typescript
import { RouterManager } from '@janhq/core'  // ← Added import

export function ExtensionProvider({ children }: PropsWithChildren) {
  const setupExtensions = useCallback(async () => {
    // ...
    window.core.routerManager = RouterManager.instance()  // ← Added this
    // ...
  }, [])
}
```

### 3. Enhanced Logging in Settings Page
**File:** `web-app/src/routes/settings/router.tsx`

Added detailed console logging to track:
- RouterManager instance creation
- Router availability checks
- Retry attempts
- Success/failure states

## How It Works Now

1. **App Startup:**
   - `ExtensionProvider` creates `RouterManager.instance()` singleton
   - Adds it to `window.core.routerManager`
   - Loads all extensions (including router-extension)

2. **Router Extension Loads:**
   - `RouterExtension.onLoad()` is called
   - Calls `RouterManager.instance().register(this)`
   - Router is now registered and available

3. **Settings Page Access:**
   - Component calls `RouterManager.instance().get()`
   - Gets the same singleton instance
   - Router is available, strategies load successfully

## Testing

### Check Browser Console
You should now see these logs:
```
[RouterExtension] Loading model router
[RouterExtension] Active strategy: heuristic
[Router Settings] Attempting to load router...
[Router Settings] RouterManager instance: RouterManager {...}
[Router Settings] Router from manager: RouterExtension {...}
[Router Settings] Loaded successfully: { strategies: [...], currentStrategy: '...' }
```

### Verify in DevTools
```javascript
// Open browser console (F12)
window.core.routerManager
// Should show: RouterManager {router: RouterExtension, ...}

window.core.routerManager.get()
// Should show: RouterExtension {activeStrategy: ..., ...}

window.core.routerManager.get().listStrategies()
// Should show: [{name: 'heuristic', ...}, {name: 'llm-based', ...}]
```

### UI Behavior
1. Navigate to Settings → Router
2. Should see:
   - ✅ Auto Routing toggle
   - ✅ Strategy selection (Heuristic / LLM-based)
   - ✅ How It Works cards
3. No "Router extension not loaded" error

## Why This Fix Works

**Before:**
- `RouterManager.instance()` was being called separately in different parts of the app
- No guarantee that the same instance was being used
- Settings page might have been getting a different instance than the extension

**After:**
- Single `RouterManager` instance created at app startup
- Stored in `window.core.routerManager`
- All parts of the app access the same instance
- Router extension registers to this global instance
- Settings page reads from this global instance

## Related Changes

- **Core Package**: Already exports `RouterManager` (no changes needed)
- **Extension**: Already registers with `RouterManager` (no changes needed)
- **Settings Page**: Already uses `RouterManager.instance()` (no changes needed)

Only needed to:
1. Make RouterManager globally accessible
2. Add proper TypeScript types
3. Enhance logging for debugging

## Files Modified

1. ✅ `web-app/src/types/global.d.ts` - Added RouterManager type
2. ✅ `web-app/src/providers/ExtensionProvider.tsx` - Initialize RouterManager globally
3. ✅ `web-app/src/routes/settings/router.tsx` - Enhanced logging (debugging)

## Next Steps

1. Test the settings page in browser
2. Verify console logs show successful loading
3. Test strategy switching works
4. Test auto routing toggle works
5. Verify settings persist across app restarts

---

**Status:** ✅ Fix implemented and ready for testing
**Estimated Impact:** Router settings should now load successfully
