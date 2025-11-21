# Rebuilding Jan After Code Changes

This guide explains when and how to rebuild Jan after making changes to the codebase, especially when working with the core package, extensions, or adding new features.

---

## 🎯 When Do You Need to Rebuild?

### Always Rebuild After:
- ✅ Adding new types or exports to `core/src/`
- ✅ Creating or modifying extensions
- ✅ Adding new extension types (like RouterExtension)
- ✅ Changing core package exports
- ✅ Modifying shared types used across packages

### Usually Rebuild After:
- ⚠️ Updating dependencies in `package.json`
- ⚠️ Changing Tauri configuration
- ⚠️ Modifying build configurations (vite.config.ts, rolldown.config.mjs)

### No Rebuild Needed:
- ❌ Editing React components in `web-app/src/`
- ❌ Modifying UI styles
- ❌ Updating markdown documentation

---

## 🔧 Quick Rebuild (After Core Changes)

If you've made changes to the **core package** (like adding RouterManager, new types, etc.):

```bash
# 1. Rebuild core package
cd core
yarn build

# 2. Re-link workspace packages
cd ..
yarn install

# 3. Clear Vite cache
rm -rf web-app/node_modules/.vite

# 4. Restart dev server
make dev
```

**Time:** ~30 seconds

---

## 🏗️ Full Rebuild (Clean Build)

When you encounter persistent import errors or need a guaranteed clean state:

```bash
# Stop the dev server (Ctrl+C if running)

# Clean all build artifacts and caches
rm -rf core/dist
rm -rf web-app/node_modules/.vite
rm -rf pre-install/*.tgz

# Rebuild everything
make dev
```

**Time:** ~2-3 minutes (builds core → extensions → web-app)

**What `make dev` does:**
1. Builds the core package (`core/dist/`)
2. Builds all extensions (`extensions/*/dist/`)
3. Packages extensions to `.tgz` files (`pre-install/`)
4. Starts the Tauri dev server

---

## 🧹 Nuclear Option (Complete Clean Rebuild)

Use this when you have unexplainable errors or after switching branches:

```bash
# Remove ALL node_modules and build artifacts
rm -rf node_modules
rm -rf web-app/node_modules
rm -rf core/node_modules
rm -rf extensions/*/node_modules
rm -rf core/dist
rm -rf web-app/node_modules/.vite
rm -rf pre-install/*.tgz

# Reinstall dependencies
yarn install

# Rebuild everything
make dev
```

**Time:** ~5-10 minutes (depending on internet speed and CPU)

---

## 📦 Extension-Specific Rebuild

If you've only modified an extension (e.g., router-extension):

```bash
# Build the specific extension
cd extensions/router-extension
yarn build

# Package it
npm pack

# Move to pre-install
mv *.tgz ../../pre-install/

# Restart Jan
cd ../..
make dev
```

**Or use the Makefile:**

```bash
make build:extensions
make dev
```

---

## 🐛 Common Issues & Solutions

### Issue: "Cannot find module '@janhq/core'"

**Cause:** Web-app hasn't picked up the rebuilt core package

**Solution:**
```bash
cd core && yarn build && cd ..
yarn install
rm -rf web-app/node_modules/.vite
make dev
```

---

### Issue: "RouterManager is not exported from '@janhq/core'"

**Cause:** Core package wasn't rebuilt after adding new exports

**Solution:**
```bash
# Rebuild core
cd core
yarn build

# Verify exports exist
ls -la dist/browser/extensions/RouterManager.js
ls -la dist/types/browser/extensions/RouterManager.d.ts

# Re-link and restart
cd ..
yarn install
make dev
```

---

### Issue: "Extension not loading / Extension not found"

**Cause:** Extension wasn't packaged or isn't in `pre-install/`

**Solution:**
```bash
# Check if extension tarball exists
ls -la pre-install/janhq-router-extension-*.tgz

# If missing, rebuild extensions
make build:extensions

# Restart
make dev
```

---

### Issue: "Vite stuck on old code / Changes not reflecting"

**Cause:** Vite cache holding old builds

**Solution:**
```bash
# Clear Vite cache
rm -rf web-app/node_modules/.vite

# Restart
make dev
```

---

### Issue: "Yarn workspace errors / Peer dependency warnings"

**Cause:** Workspace links broken after git operations

**Solution:**
```bash
# Re-link all workspaces
yarn install --force

# Rebuild
make dev
```

---

## 🔍 Verifying Successful Build

After rebuilding, verify everything is working:

### 1. Check Core Build
```bash
ls -la core/dist/
# Should see: index.js, index.js.map, browser/, types/
```

### 2. Check Extension Packages
```bash
ls -la pre-install/
# Should see: janhq-router-extension-1.0.0.tgz (and others)
```

### 3. Check TypeScript Exports
```bash
cat core/dist/types/browser/extensions/index.d.ts | grep RouterManager
# Should output: export { RouterManager } from './RouterManager';
```

### 4. Check Dev Server
Open browser console (F12) and look for:
- ✅ No import errors
- ✅ Extensions loaded successfully
- ✅ Router extension in window.core.extensionManager

---

## ⚡ Development Workflow Best Practices

### When Working on Core Types:

```bash
# Terminal 1: Watch mode for core
cd core
yarn build --watch

# Terminal 2: Dev server
cd ..
make dev
```

### When Working on Extensions:

```bash
# Build extension after changes
cd extensions/router-extension
yarn build
npm pack
mv *.tgz ../../pre-install/

# In Jan app, reload extensions
# OR restart make dev
```

### When Working on Web-App:

```bash
# Just make changes - Vite hot reloads automatically
# No rebuild needed for React components
```

---

## 📋 Build Order Reference

Jan uses a **monorepo with Yarn workspaces**. Build order matters:

1. **Core** (`core/`) - Base types, extensions, APIs
   - Built with Rolldown
   - Output: `core/dist/`
   
2. **Extensions** (`extensions/*/`) - Feature modules
   - Depends on core
   - Built with Rolldown
   - Output: `extensions/*/dist/`
   
3. **Extensions Web** (`extensions-web/`) - Web-bundled extensions
   - Depends on core and extensions
   - Built with Vite
   
4. **Web App** (`web-app/`) - React frontend
   - Depends on core
   - Built with Vite
   - Hot reloads during dev

5. **Tauri** (`src-tauri/`) - Rust backend
   - Built with Cargo
   - Rebuilds automatically on Rust changes

---

## 🚀 Quick Reference Commands

```bash
# Standard development
make dev                          # Full build + dev server

# Specific builds
make build:core                   # Build core package only
make build:extensions             # Build all extensions
make build:extensions-web         # Build web extensions

# Clean operations
rm -rf web-app/node_modules/.vite # Clear Vite cache
rm -rf core/dist                  # Clean core build
rm -rf pre-install/*.tgz          # Clean extension packages

# Dependency management
yarn install                      # Re-link workspaces
yarn install --force              # Force re-link
```

---

## 💡 Pro Tips

1. **Use `make dev`** - It handles the correct build order automatically

2. **Clear Vite cache often** - When you see stale code:
   ```bash
   rm -rf web-app/node_modules/.vite
   ```

3. **Check TypeScript errors first** - Before rebuilding, check for TS errors:
   ```bash
   cd web-app
   yarn tsc --noEmit
   ```

4. **Watch the terminal** - Build errors are usually clearly shown

5. **Browser DevTools** - Import errors always show in console (F12)

6. **Extension loading** - Check browser console for:
   ```javascript
   window.core.extensionManager.extensions
   // Should list all loaded extensions including router
   ```

---

## 🎯 Checklist: Adding a New Extension

- [ ] Create extension directory in `extensions/`
- [ ] Add `package.json` with correct name and version
- [ ] Implement extension class (extends BaseExtension)
- [ ] Add to `core/src/browser/extension.ts` (ExtensionTypeEnum)
- [ ] Export types from `core/src/browser/extensions/index.ts`
- [ ] Build core: `cd core && yarn build`
- [ ] Build extension: `cd extensions/my-extension && yarn build`
- [ ] Package extension: `npm pack`
- [ ] Move to pre-install: `mv *.tgz ../../pre-install/`
- [ ] Run `yarn install` in root
- [ ] Test with `make dev`

---

## 📚 Related Documentation

- **Architecture**: `CONTRIBUTING.md` - Deep dive into Jan's architecture
- **Testing**: `ROUTER_TESTING.md` - How to test router functionality
- **Implementation**: `ROUTER_IMPLEMENTATION.md` - Router implementation details
- **Integration**: `ROUTER_INTEGRATION_COMPLETE.md` - Complete integration summary

---

## ❓ Still Having Issues?

If you've tried all the steps above and still see errors:

1. **Check the exact error message** in browser console or terminal
2. **Verify file existence**: 
   ```bash
   ls -la core/dist/browser/extensions/RouterManager.js
   ls -la pre-install/janhq-router-extension-*.tgz
   ```
3. **Check TypeScript compilation**:
   ```bash
   cd web-app && yarn tsc --noEmit
   ```
4. **Look for Yarn workspace warnings** during `yarn install`
5. **Try the Nuclear Option** (complete clean rebuild)

If problems persist, it may be a legitimate bug. Check:
- File permissions
- Disk space
- Node.js version compatibility
- Git branch state

---

**Last Updated:** November 21, 2025  
**Jan Version:** Development build with Router integration
