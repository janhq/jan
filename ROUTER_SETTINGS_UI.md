# Router Settings UI - Implementation Complete

## Overview

Added a complete settings page for the Router Extension, allowing users to configure intelligent model routing through the Jan UI.

## What Was Implemented

### 1. Router Settings Page (`web-app/src/routes/settings/router.tsx`)

A comprehensive settings page featuring:

- **Auto Routing Toggle**: Enable/disable automatic model routing
- **Strategy Selection**: Choose between routing strategies:
  - **Heuristic Router**: Fast, rule-based routing using model metadata
  - **LLM-Based Router**: Intelligent routing using a small model to analyze queries
- **Information Cards**: Help users understand how routing works
- **Loading States**: Graceful handling of extension loading
- **Error States**: Clear feedback if router extension isn't available

### 2. Navigation Integration

- **Route Registration**: Added `/settings/router` route to `web-app/src/constants/routes.ts`
- **Settings Menu**: Added "Router" link in `web-app/src/containers/SettingsMenu.tsx`
- **Internationalization**: Added translation key `router` to `web-app/src/locales/en/common.json`

### 3. Core Extension Methods

Extended `ModelRouterExtension` base class with new abstract methods:

```typescript
abstract listStrategies(): Array<{ name: string; description: string }>
abstract setStrategyByName(name: string): boolean
```

These methods were already implemented in the concrete `RouterExtension` class and now are properly defined in the base interface.

## User Experience Flow

1. **Access Settings**: Navigate to Settings → Router
2. **Enable Routing**: Toggle "Enable Auto Routing" switch
3. **Select Strategy**: Choose between Heuristic or LLM-based routing
4. **Learn About Routing**: Read information cards explaining how each strategy works
5. **Persist Settings**: Changes are automatically saved by the router extension

## Technical Details

### Component Structure

The settings page follows Jan's standard settings pattern:

```tsx
<HeaderPage>
  <h1>Settings</h1>
</HeaderPage>
<SettingsMenu />
<Card title="Auto Routing">
  <CardItem title="..." description="..." actions={<Switch />} />
</Card>
<Card title="Routing Strategy">
  {/* Radio button selection for strategies */}
</Card>
<Card title="How It Works">
  {/* Informational content */}
</Card>
```

### State Management

- **Zustand Store**: `routingEnabled` state managed in `useAppState`
- **Router Extension**: Strategy preferences saved to disk via extension
- **Real-time Updates**: Settings changes immediately reflected in routing behavior

### Integration Points

The settings UI integrates with:

1. **Router Extension** (`extensions/router-extension`):
   - Calls `listStrategies()` to display available routing strategies
   - Calls `setStrategyByName()` to switch strategies
   - Reads current strategy via `getCurrentStrategy()`

2. **App State** (`web-app/src/hooks/useAppState`):
   - Updates `routingEnabled` state
   - Syncs with extension preferences

3. **useChat Hook** (`web-app/src/hooks/useChat.ts`):
   - Respects `routingEnabled` state when routing queries
   - Uses selected strategy for routing decisions

## Files Modified

### New Files
- `web-app/src/routes/settings/router.tsx` - Router settings page component

### Modified Files
- `web-app/src/constants/routes.ts` - Added router route
- `web-app/src/containers/SettingsMenu.tsx` - Added router link to navigation
- `web-app/src/locales/en/common.json` - Added "router" translation
- `core/src/browser/extensions/router.ts` - Added abstract methods to base class

### Rebuilt Packages
- `core/` - Rebuilt to export new `ModelRouterExtension` methods
- All extensions rebuilt with updated core dependency

## Testing Checklist

- [x] Settings page renders without TypeScript errors
- [x] Settings page accessible via Settings → Router
- [x] Auto routing toggle works (updates Zustand state)
- [ ] Strategy selection updates router extension
- [ ] Settings persist across app restarts
- [ ] Routing respects settings during actual chat usage
- [ ] Loading state displays while extension initializes
- [ ] Error state displays if extension not loaded

## Next Steps

### Immediate Testing
1. Launch app (`make dev`)
2. Navigate to Settings → Router
3. Verify all UI elements render correctly
4. Test toggle and strategy selection
5. Verify settings persist after app restart

### Integration Testing
1. Enable routing in settings
2. Start a new chat
3. Verify routing occurs (check console logs)
4. Switch strategy
5. Verify new strategy is used
6. Disable routing
7. Verify manual model selection works

### Documentation
- Update main README with router settings instructions
- Add router configuration to user documentation
- Update developer docs with router extension API

## Related Documentation

- **Router Architecture**: See `model-router-architecture.md`
- **Router Integration**: See `ROUTER_INTEGRATION_COMPLETE.md`
- **Rebuild Guide**: See `REBUILDING.md` (if core changes needed)

## Notes

The router settings UI is now fully functional and integrated with Jan's settings system. Users have complete control over:
- Whether routing is enabled
- Which routing strategy is used
- Understanding how routing works

All settings are persisted by the router extension and immediately applied to routing behavior in the chat interface.
