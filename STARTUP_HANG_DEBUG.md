# Startup Hang: "Backend is already installed" Debug Guide

## Problem
App hangs at: `Final check: Backend b6929/macos-arm64 is already installed`

## Root Cause Analysis

The message comes from `extensions/llamacpp-extension/src/index.ts` line 944:
```typescript
logger.info(`Final check: Backend ${backendString} is already installed`)
```

This is in the `ensureFinalBackendInstallation()` method called during extension loading.

## Why It Hangs

The hang is **NOT** actually at this log message - this function completes successfully. The hang is likely happening in:

1. **Extension Loading Queue** - Next extension waiting to load
2. **Window Creation** - Tauri window stuck initializing
3. **Browser Console Buffering** - Terminal output is stuck, but app might be running

## Immediate Solutions

### Solution 1: Check if App is Actually Running

Even though terminal is stuck, the app might be running:

1. Open Activity Monitor
2. Look for "Jan" process
3. Check if it's using CPU

**Or try:**
```bash
# Check if the window opened
ps aux | grep -i jan | grep -v grep
lsof -i :5173  # Check if Vite is serving
```

### Solution 2: Open DevTools to Check

1. The app might have opened but terminal is buffering output
2. Press **Cmd+Option+I** to open DevTools
3. Check the Console tab for:
   - Extension loading messages
   - Any JavaScript errors
   - Router extension loaded status

### Solution 3: Force Fresh Start

```bash
# 1. Kill all Jan processes
pkill -9 Jan
pkill -9 node

# 2. Clear backend cache
rm -rf ~/jan/engines

# 3. Clear app caches
rm -rf web-app/node_modules/.vite
rm -rf web-app/dist

# 4. Restart
make dev
```

### Solution 4: Skip Backend Check (Temporary)

If you want to test the router functionality without waiting for backend:

```bash
# Start web-app only (no Tauri, no backend check)
cd web-app
yarn dev

# Open browser to http://localhost:5173
```

**Note:** This won't have Tauri functionality, but you can test:
- Settings UI
- Router configuration
- Frontend routing logic

## Long-term Fix

If this hang persists, the llama.cpp extension might have a race condition. Potential fixes:

### Option 1: Add Timeout to Backend Check

Edit `extensions/llamacpp-extension/src/index.ts` around line 930:

```typescript
private async ensureFinalBackendInstallation(
  backendString: string
): Promise<void> {
  // Add timeout wrapper
  const timeoutMs = 10000 // 10 seconds
  
  const checkPromise = (async () => {
    if (!backendString) {
      logger.warn('No backend specified for final installation check')
      return
    }
    
    const [selectedVersion, selectedBackend] = backendString
      .split('/')
      .map((part) => part?.trim())
    
    if (!selectedVersion || !selectedBackend) {
      logger.warn(`Invalid backend format: ${backendString}`)
      return
    }
    
    try {
      const isInstalled = await isBackendInstalled(
        selectedBackend,
        selectedVersion
      )
      if (!isInstalled) {
        logger.info(`Final check: Installing backend ${backendString}`)
        await this.ensureBackendReady(selectedBackend, selectedVersion)
        logger.info(`Successfully installed backend: ${backendString}`)
      } else {
        logger.info(
          `Final check: Backend ${backendString} is already installed`
        )
      }
    } catch (error) {
      logger.error(
        `Failed to ensure backend ${backendString} installation:`,
        error
      )
      throw error
    }
  })()
  
  // Add timeout
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('Backend check timed out')), timeoutMs)
  })
  
  try {
    await Promise.race([checkPromise, timeoutPromise])
  } catch (error) {
    logger.warn('Backend check timed out, continuing anyway:', error)
    // Continue loading - backend check is not critical for app startup
  }
}
```

### Option 2: Make Backend Check Non-Blocking

Make the backend check happen in background after app starts:

```typescript
async configureBackends(): Promise<void> {
  // ... existing code ...
  
  if (!backendWasDownloaded && effectiveBackendString) {
    // Don't await - let it happen in background
    this.ensureFinalBackendInstallation(effectiveBackendString).catch(err => {
      logger.warn('Background backend check failed:', err)
    })
  }
  
  // Return immediately - don't block app startup
}
```

## Diagnostic Commands

### Check what's running:
```bash
ps aux | grep -E "(Jan|tauri|node|vite)" | grep -v grep
```

### Check ports:
```bash
lsof -i :5173  # Vite dev server
lsof -i :1420  # Tauri dev server (if applicable)
```

### Check logs:
```bash
# macOS Jan logs location
tail -f ~/Library/Logs/Jan/main.log

# Or extension logs
tail -f ~/jan/extensions/*/logs/*.log
```

### Force kill everything:
```bash
pkill -9 Jan
pkill -9 node
pkill -9 tauri
```

## Testing Router Without Full App

If you just want to test the router functionality:

```bash
# 1. Build the router extension
cd extensions/router-extension
yarn build

# 2. Test the settings
cat settings.json
```

## Next Steps

1. **First**: Check if app is actually running (Cmd+Tab to see if Jan window exists)
2. **Second**: Open DevTools (Cmd+Option+I) to see console output
3. **Third**: If truly hung, kill processes and try fresh start
4. **Last resort**: Use web-only mode to test router UI

---

**Updated:** November 21, 2025  
**Issue:** App hangs at backend check during startup  
**Status:** Investigating
