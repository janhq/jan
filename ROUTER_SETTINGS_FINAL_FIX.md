# Router Settings - Final Fix Summary

## Problem Diagnosis
The router settings page showed "Router extension not loaded" because the `RouterManager` singleton instance being used by the router extension (`RouterManager.instance()`) was different from the one created in `ExtensionProvider` and stored in `window.core.routerManager`.

## Root Cause
**Module Bundling Issue**: The router extension is bundled separately and may create its own singleton instance when calling `RouterManager.instance()`, separate from the instance created by the web app.

## Solution Implemented

### 1. Make RouterManager Globally Accessible
**Files Modified:**
- `web-app/src/types/global.d.ts` - Added `routerManager?: RouterManager` to `AppCore` type
- `web-app/src/providers/ExtensionProvider.tsx` - Initialize `window.core.routerManager = RouterManager.instance()`

### 2. Use Global Instance in Extension
**File Modified:** `extensions/router-extension/src/index.ts`

Changed from:
```typescript
async onLoad() {
  RouterManager.instance().register(this)
  // ...
}
```

To:
```typescript
async onLoad() {
  // Use window.core.routerManager if available (ensures same singleton)
  const routerManager = typeof window !== 'undefined' && window.core?.routerManager 
    ? window.core.routerManager 
    : RouterManager.instance()
  
  routerManager.register(this)
  console.log('[RouterExtension] Registered with RouterManager:', routerManager)
  // ...
}
```

### 3. Enhanced Logging
Added detailed console logging in:
- `extensions/router-extension/src/index.ts` - Logs RouterManager instance
- `web-app/src/routes/settings/router.tsx` - Logs loading process

## How to Verify the Fix

### 1. Check Browser Console
After navigating to Settings → Router, you should see:

```
[RouterExtension] Loading model router
[RouterExtension] Registered with RouterManager: RouterManager {router: RouterExtension, ...}
[RouterExtension] Active strategy: heuristic
[Router Settings] Attempting to load router...
[Router Settings] RouterManager instance: RouterManager {router: RouterExtension, ...}
[Router Settings] Router from manager: RouterExtension {activeStrategy: HeuristicRouter, ...}
[Router Settings] Loaded successfully: {strategies: [...], currentStrategy: 'heuristic'}
```

### 2. Verify in DevTools Console
```javascript
// All of these should return the SAME instance
window.core.routerManager
window.core.routerManager.get()
window.core.routerManager.get().listStrategies()
```

### 3. UI Should Show
✅ Auto Routing toggle  
✅ Strategy selection with Heuristic/LLM-based options  
✅ Information cards explaining routing  
❌ NO "Router extension not loaded" error

## Technical Details

### Singleton Pattern Across Modules
When using singleton pattern with bundled modules:

**Problem**: Each bundled module may create its own instance
```typescript
// web-app bundle
const manager1 = RouterManager.instance() // Instance A

// router-extension bundle  
const manager2 = RouterManager.instance() // Instance B (different!)
```

**Solution**: Use a global reference point
```typescript
// web-app creates and stores
window.core.routerManager = RouterManager.instance() // Instance A

// router-extension uses global
const manager = window.core.routerManager // Same Instance A
```

### Extension Loading Flow
1. **App Startup** (`ExtensionProvider`):
   - Creates `window.core.routerManager` singleton
   - Starts loading all extensions

2. **Router Extension Loads**:
   - `onLoad()` called by ExtensionManager
   - Uses `window.core.routerManager` to register
   - Router is now available globally

3. **Settings Page Accesses**:
   - Uses `RouterManager.instance().get()`
   - Gets the router from the same global instance
   - Successfully displays strategies

## Files Changed

| File | Change | Status |
|------|--------|--------|
| `web-app/src/types/global.d.ts` | Added `routerManager` to AppCore type | ✅ |
| `web-app/src/providers/ExtensionProvider.tsx` | Initialize `window.core.routerManager` | ✅ |
| `extensions/router-extension/src/index.ts` | Use `window.core.routerManager` if available | ✅ |
| `web-app/src/routes/settings/router.tsx` | Enhanced logging | ✅ |
| `extensions/router-extension/dist/` | Rebuilt | ✅ |
| `pre-install/janhq-router-extension-1.0.0.tgz` | Repackaged | ✅ |

## Build Steps Completed

```bash
# 1. Rebuilt router extension with fix
cd extensions/router-extension
yarn build

# 2. Packaged extension
npm pack

# 3. Moved to pre-install
mv janhq-router-extension-*.tgz ../../pre-install/

# 4. Restarted app
cd ../..
make dev
```

## Testing Checklist

- [ ] App starts without errors
- [ ] Navigate to Settings → Router
- [ ] Page loads successfully (no "extension not loaded" error)
- [ ] See Auto Routing toggle
- [ ] See Strategy selection (Heuristic / LLM-based)
- [ ] Toggle auto routing on/off - works
- [ ] Switch strategies - works
- [ ] Check browser console - see successful loading logs
- [ ] Refresh page - settings still load correctly
- [ ] Restart app - settings persist

## Why This Fix Works

**Before**: Two separate RouterManager instances existed
- Web app created one instance
- Router extension created another instance  
- Extension registered with instance B
- Settings page queried instance A (empty)

**After**: Single shared RouterManager instance
- Web app creates instance and stores in `window.core.routerManager`
- Router extension uses the same instance from `window.core`
- Extension registers with shared instance
- Settings page queries the same shared instance (contains router)

## Related Documentation

- `ROUTER_SETTINGS_UI.md` - Original settings implementation
- `ROUTER_SETTINGS_TROUBLESHOOTING.md` - Initial troubleshooting
- `ROUTER_SETTINGS_FIX.md` - First fix attempt (global access)
- `REBUILDING.md` - Guide for rebuilding after changes

---

**Status**: ✅ **FIX IMPLEMENTED AND DEPLOYED**  
**Next Step**: Test in running app and verify router settings page works correctly
