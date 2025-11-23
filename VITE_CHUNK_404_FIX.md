# Vite "chunk-B4FVXKMO.js" 404 Error Fix

## Problem

Error when starting the app:
```
Failed to load resource: the server responded with a status of 404 (Not Found)
http://localhost:1420/node_modules/.vite/deps/chunk-B4FVXKMO.js?v=be549923

The file does not exist at "/Users/maot/projects/aeterna-chat/web-app/node_modules/.vite/deps/chunk-B4FVXKMO.js?v=be549923" which is in the optimize deps directory. The dependency might be incompatible with the dep optimizer. Try adding it to `optimizeDeps.exclude`.
```

## Root Cause

This is a **Vite dependency pre-bundling cache corruption issue**. 

When Vite starts, it pre-bundles dependencies into optimized chunks for faster loading. These are stored in `web-app/node_modules/.vite/deps/`. The cache includes:
- Bundled dependency chunks (e.g., `chunk-B4FVXKMO.js`)
- A manifest file mapping dependencies to chunks
- Cache-busting hashes (e.g., `?v=be549923`)

**What went wrong:**
1. Vite created a manifest referencing `chunk-B4FVXKMO.js` with hash `v=be549923`
2. The chunk file was either:
   - Not created due to a build interruption
   - Deleted manually when clearing caches
   - Became stale after code changes
3. Vite kept trying to load the old reference from its manifest
4. 404 error because the file doesn't exist

**Why clearing `.vite` folder didn't work initially:**
- The manifest file or some cached references persisted
- Vite was still trying to use the old hash `v=be549923`
- Needed to delete ALL `.js` files in `.vite` directory, not just the folder

## Solution

### Quick Fix (What We Did)

```bash
# 1. Kill all running processes
pkill -9 Jan && pkill -9 node

# 2. Delete ALL Vite cache files (not just the folder)
cd /Users/maot/projects/aeterna-chat
find web-app/node_modules/.vite -name "*.js" -delete
rm -rf web-app/node_modules/.vite/deps

# 3. Rebuild core (to ensure fresh build)
rm -rf core/dist
yarn build:core

# 4. Start dev server fresh
make dev
```

###Alternative Fix Options

#### Option 1: Force Vite Rebuild
```bash
cd web-app
yarn dev -- --force
```

The `--force` flag tells Vite to ignore cache and rebuild everything.

#### Option 2: Complete Clean Build
```bash
# Nuclear option - clears everything
rm -rf web-app/node_modules/.vite
rm -rf web-app/dist
rm -rf web-app/node_modules

yarn install
make dev
```

#### Option 3: Add Problem Dependency to Exclude List

If a specific dependency keeps causing issues, exclude it from pre-bundling:

Edit `web-app/vite.config.ts`:
```typescript
export default defineConfig({
  // ... other config
  optimizeDeps: {
    exclude: [
      'problematic-package-name'  // Add the package causing issues
    ],
  },
})
```

## Prevention

### When to Clear Vite Cache

Clear the Vite cache after:
- ✅ Adding new dependencies to `package.json`
- ✅ Upgrading dependency versions
- ✅ Switching git branches with different dependencies
- ✅ After build interruptions (Ctrl+C during startup)
- ✅ Modifying code that Vite pre-bundles (rare)
- ✅ Seeing 404 errors for chunk files
- ✅ "Module not found" errors that don't make sense

### Quick Cache Clear Command

Add this to your workflow:
```bash
# Fast cache clear
rm -rf web-app/node_modules/.vite && make dev
```

### Understanding Vite Cache Structure

```
web-app/node_modules/.vite/
├── deps/                    # Pre-bundled dependencies
│   ├── chunk-XXXXX.js      # Bundled chunks
│   ├── package-name.js     # Individual packages
│   └── _metadata.json      # Dependency metadata
├── deps-temp/              # Temporary files during build
└── _optimize_deps.json     # Optimization manifest
```

**Key files that can get corrupted:**
- `_metadata.json` - Maps dependencies to chunks
- `_optimize_deps.json` - Optimization settings
- Individual chunk files - Can become stale

## Common Vite Cache Issues

### Issue 1: Stale Chunk Reference
**Symptom:** 404 on `chunk-XXXXX.js`  
**Fix:** Delete `.vite` folder

### Issue 2: Wrong Module Version
**Symptom:** "TypeError: X is not a function" after dependency update  
**Fix:** Clear cache and rebuild

### Issue 3: "Optimized dependencies changed. Reloading"
**Symptom:** Infinite reload loop  
**Fix:** Delete `.vite/deps` folder

### Issue 4: Import Errors After Git Operations
**Symptom:** "Cannot find module" after branch switch  
**Fix:** `rm -rf web-app/node_modules/.vite && yarn install`

## Diagnostic Commands

### Check what Vite cached:
```bash
ls -la web-app/node_modules/.vite/deps/
```

### Check cache size:
```bash
du -sh web-app/node_modules/.vite
```

### Find specific chunk:
```bash
find web-app/node_modules/.vite -name "*B4FVXKMO*"
```

### Check Vite manifest:
```bash
cat web-app/node_modules/.vite/deps/_metadata.json | jq .
```

## Vite Configuration Best Practices

### Optimize for Stability

Edit `web-app/vite.config.ts`:
```typescript
export default defineConfig({
  cacheDir: 'node_modules/.vite', // Default location
  optimizeDeps: {
    // Force include dependencies that should always be pre-bundled
    include: [
      '@janhq/core',
      'react',
      'react-dom',
    ],
    // Exclude problematic dependencies
    exclude: [],
    // Force rebuild on these file changes
    entries: [
      'src/**/*.tsx',
      'src/**/*.ts',
    ],
  },
  server: {
    // Increase dependency check time (default: 0)
    fs: {
      strict: false,
    },
  },
})
```

### Clear Cache Automatically

Add to `package.json`:
```json
{
  "scripts": {
    "dev": "vite",
    "dev:fresh": "rm -rf node_modules/.vite && vite",
    "dev:force": "vite --force"
  }
}
```

## When the Fix Doesn't Work

If clearing `.vite` doesn't fix the issue:

1. **Check for Browser Cache**
   - Hard refresh: Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows)
   - Or open DevTools → Network → Disable cache

2. **Check for Service Workers**
   - Open DevTools → Application → Service Workers → Unregister

3. **Check for Conflicting Processes**
   ```bash
   lsof -i :5173  # Vite dev server
   lsof -i :1420  # Tauri dev server
   ```

4. **Verify Dependency Installation**
   ```bash
   cd web-app
   yarn install --check-files
   ```

5. **Check for Circular Dependencies**
   ```bash
   npx madge --circular web-app/src
   ```

## Build Order for Clean State

Correct order to rebuild everything:

```bash
# 1. Stop all processes
pkill -9 Jan && pkill -9 node

# 2. Clean ALL caches
rm -rf web-app/node_modules/.vite
rm -rf web-app/dist
rm -rf core/dist
rm -rf pre-install/*.tgz

# 3. Rebuild in order
yarn build:core           # Build core package
yarn build:extensions     # Build all extensions
yarn build:extensions-web # Build web extensions

# 4. Start fresh
make dev
```

## Testing the Fix

After clearing cache and rebuilding:

1. **Check Vite output** - Should see:
   ```
   ✨ new dependencies optimized: ...
   ✨ optimized dependencies changed. reloading
   ```

2. **Check browser console** - Should NOT see:
   - 404 errors for chunk files
   - "Importing a module script failed"
   - Module resolution errors

3. **Check Network tab** - All chunk files should return 200 OK

## Summary

**The Issue:** Vite's dependency cache became corrupted, referencing non-existent chunk files

**The Fix:** Delete ALL Vite cache files (not just the folder):
```bash
find web-app/node_modules/.vite -name "*.js" -delete
rm -rf web-app/node_modules/.vite/deps
```

**Why it happened:** Build interruption or manual cache clearing left stale references in Vite's manifest

**How to prevent:** Always use `make dev` (don't interrupt builds) and clear `.vite` after dependency changes

---

**Last Updated:** November 21, 2025  
**Issue:** Vite chunk 404 error (chunk-B4FVXKMO.js)  
**Status:** ✅ FIXED
