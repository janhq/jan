# Router Settings Troubleshooting

## Issue
User cannot see router settings when navigating to Settings → Router

## Investigation

### 1. Route Configuration ✅
- Route properly defined in `/web-app/src/constants/routes.ts` as `router: '/settings/router'`
- Route properly registered in TanStack Router's `routeTree.gen.ts`
- Route file exists at `/web-app/src/routes/settings/router.tsx`
- SettingsMenu has "Router" link added
- Translation added to `common.json`

### 2. Component Structure ✅
- Component exports proper Route using `createFileRoute`
- Uses standard Jan settings pattern (HeaderPage > SettingsMenu > Cards)
- Has loading and error states

### 3. RouterManager Export ✅
- `RouterManager` class exists at `/core/src/browser/extensions/RouterManager.ts`
- Properly exported from `/core/src/browser/extensions/index.ts`
- Component imports it from `@janhq/core`

### 4. Extension Registration ✅
- Router extension properly registers with RouterManager in `onLoad()`
- Located at `/extensions/router-extension/src/index.ts` line 34

## Root Cause

**Timing Issue**: The settings page component mounts and tries to load router settings before the router extension has finished loading and registering itself with `RouterManager`.

When `RouterManager.instance().get()` is called:
- If extension hasn't loaded yet → returns `null`
- Component catches error, `strategies` stays empty
- Empty strategies triggers error state: "Router extension not loaded"

## Solution Implemented

Added retry logic to `loadRouterSettings()` in `/web-app/src/routes/settings/router.tsx`:

1. First attempt to get router from RouterManager
2. If router is `null`, wait 500ms and retry once
3. Add console logging to track loading status
4. Only show error state if router still isn't available after retry

### Code Changes

```typescript
// Added retry logic with 500ms delay
if (router) {
  // Load normally
} else {
  console.warn('[Router Settings] Router extension not yet loaded, retrying...')
  setTimeout(() => {
    // Retry getting router
    const retryRouter = RouterManager.instance().get()
    if (retryRouter) {
      // Load strategies
    }
    setLoading(false)
  }, 500)
  return // Don't set loading false yet
}
```

## Testing Steps

1. **Clear Vite cache** (already done):
   ```bash
   rm -rf web-app/node_modules/.vite .vite dist
   ```

2. **Restart dev server**:
   ```bash
   make dev
   ```

3. **Navigate to Settings → Router**:
   - Should see loading state briefly
   - Then should see router settings with:
     - Auto Routing toggle
     - Strategy selection (Heuristic / LLM-based)
     - Information cards

4. **Check console logs**:
   - Look for `[Router Settings] Loaded successfully`
   - OR `[Router Settings] Router extension not yet loaded, retrying...`
   - OR `[Router Settings] Loaded successfully on retry`

## Alternative Solutions (if retry doesn't work)

### Option 1: Use Extension Loading State
Monitor global extension loading state before attempting to access RouterManager:

```typescript
const extensionsLoaded = useAppState((state) => state.extensionsLoaded)

useEffect(() => {
  if (extensionsLoaded) {
    loadRouterSettings()
  }
}, [extensionsLoaded])
```

### Option 2: Polling Until Available
Keep polling until router is available:

```typescript
const loadRouterSettings = useCallback(async () => {
  let retries = 0
  const maxRetries = 10
  
  const tryLoad = () => {
    const router = RouterManager.instance().get()
    if (router) {
      // Load strategies
      setLoading(false)
    } else if (retries < maxRetries) {
      retries++
      setTimeout(tryLoad, 200)
    } else {
      setLoading(false) // Give up
    }
  }
  
  tryLoad()
}, [])
```

### Option 3: Event-Based Loading
Listen for router registration event:

```typescript
useEffect(() => {
  const handleRouterRegistered = () => {
    loadRouterSettings()
  }
  
  events.on('router:registered', handleRouterRegistered)
  
  // Also try loading immediately
  loadRouterSettings()
  
  return () => {
    events.off('router:registered', handleRouterRegistered)
  }
}, [])
```

## Expected Behavior After Fix

1. User navigates to Settings → Router
2. Brief loading screen (< 500ms)
3. Router settings page displays with:
   - **Auto Routing Card**: Toggle to enable/disable routing
   - **Routing Strategy Card**: Radio buttons to select strategy
   - **How It Works Card**: Information about routing
4. Changes persist across app restarts
5. Console shows successful loading logs

## Related Files

- `/web-app/src/routes/settings/router.tsx` - Settings page component (MODIFIED)
- `/web-app/src/containers/SettingsMenu.tsx` - Navigation menu (MODIFIED)
- `/web-app/src/constants/routes.ts` - Route constants (MODIFIED)
- `/core/src/browser/extensions/RouterManager.ts` - RouterManager singleton
- `/core/src/browser/extensions/router.ts` - Base router types
- `/core/src/browser/extensions/index.ts` - Core exports
- `/extensions/router-extension/src/index.ts` - Concrete router implementation

## Status

✅ **Solution implemented**: Added 500ms retry logic
⏳ **Testing required**: Need to verify fix works in running app
📋 **Next steps**: Test in browser, verify console logs, check settings functionality
