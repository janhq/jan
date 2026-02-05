# Multi-Select Thread Feature

## Overview

This feature allows users to select multiple chat threads simultaneously and perform bulk operations on them, improving thread management efficiency.

## Features

### ✨ Core Functionality

- **Visual Selection**: Checkbox-based selection UI
- **Keyboard Shortcuts**:
  - `Cmd/Ctrl + Click`: Multi-select individual threads
  - `Shift + Click`: Range selection
  - `Cmd/Ctrl + A`: Select all threads (in selection mode)
  - `Escape`: Exit selection mode
- **Bulk Operations**:
  - Delete multiple threads
  - Star/Unstar multiple threads
  - Assign threads to projects
  - Remove threads from projects

### 🎨 User Experience

- **Floating Action Toolbar**: Appears when threads are selected
- **Visual Feedback**: Selected threads highlighted with primary color ring
- **Selection Counter**: Shows count of selected threads
- **Confirmation Dialogs**: Safety prompts for destructive operations
- **Responsive Design**: Works on desktop and mobile

## Architecture

### State Management

**File**: `web-app/src/hooks/useThreadSelection.ts`

Zustand store managing:

- `selectedThreadIds`: Set of selected thread IDs
- `isSelectionMode`: Boolean for multi-select UI state
- `lastSelectedId`: Last selected thread for range selection

### UI Components

#### 1. BulkThreadActionsToolbar

**File**: `web-app/src/containers/BulkThreadActionsToolbar.tsx`

Floating toolbar with bulk actions:

- Star/Unstar selected threads
- Assign to project (dropdown)
- Delete selected threads
- Cancel selection

#### 2. BulkThreadActionsDialog

**File**: `web-app/src/containers/dialogs/BulkThreadActionsDialog.tsx`

Confirmation dialogs for:

- Bulk delete confirmation
- Bulk unstar confirmation

#### 3. ThreadList Updates

**File**: `web-app/src/containers/ThreadList.tsx`

Enhanced with:

- Checkbox UI in selection mode
- Click handling for selection vs navigation
- Visual styling for selected state
- Shift-click range selection support

#### 4. LeftPanel Integration

**File**: `web-app/src/containers/LeftPanel.tsx`

Added:

- Multi-select toggle button (checklist icon)
- Keyboard shortcuts handler
- Toolbar integration
- Select all option in dropdown

## Usage

### For End Users

1. **Enter Multi-Select Mode**:
   - Click the checklist icon (☑️) next to "Recents" header
   - Or use keyboard shortcut

2. **Select Threads**:
   - Click checkbox or thread row to select
   - Hold `Shift` and click to select range
   - Hold `Cmd/Ctrl` and click for multi-select

3. **Perform Bulk Actions**:
   - Use floating toolbar at bottom of screen
   - Choose action: Star, Assign to Project, or Delete
   - Confirm destructive operations

4. **Exit Multi-Select**:
   - Click checklist icon again
   - Press `Escape` key
   - Click cancel (×) in toolbar

### For Developers

#### Using the Hook

```typescript
import { useThreadSelection } from '@/hooks/useThreadSelection'

function MyComponent() {
  const {
    isSelectionMode,
    toggleSelectionMode,
    isSelected,
    toggleThread,
    selectAll,
    clearSelection,
    getSelectedCount,
    getSelectedThreadIds,
  } = useThreadSelection()

  // Toggle selection mode
  const handleToggle = () => toggleSelectionMode()

  // Select a thread
  const handleSelect = (threadId: string) => {
    toggleThread(threadId)
  }

  // Select with shift-click
  const handleShiftSelect = (threadId: string, allIds: string[]) => {
    toggleThread(threadId, true, allIds)
  }

  // Get selected for bulk operations
  const performBulkAction = () => {
    const selectedIds = getSelectedThreadIds()
    // Process selectedIds...
  }
}
```

#### Adding New Bulk Operations

1. **Add action to BulkThreadActionsToolbar**:

```typescript
// In BulkThreadActionsToolbar.tsx
const handleMyBulkAction = useCallback(async () => {
  const idsToProcess = getSelectedThreadIds()

  try {
    await Promise.all(idsToProcess.map((id) => myActionFunction(id)))

    toast.success('Bulk action completed')
    clearSelection()
  } catch (error) {
    toast.error('Bulk action failed')
  }
}, [getSelectedThreadIds, clearSelection])
```

2. **Add UI button**:

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={handleMyBulkAction}
  className="gap-2"
>
  <IconMyAction size={16} />
  <span>My Action</span>
</Button>
```

## Performance Considerations

### Optimizations

- **Batch API Calls**: All bulk operations use `Promise.all()` for parallel execution
- **Memoized Components**: ThreadList items are memoized with `React.memo()`
- **Efficient State**: Uses `Set` for O(1) lookup of selected threads
- **Debounced Updates**: Selection changes don't trigger unnecessary re-renders

### Scalability

- Tested with 100+ threads
- Optimized for large selections (50+ threads)
- Minimal re-renders during selection changes

## Accessibility

### ARIA Labels

- Checkboxes have descriptive labels
- Toolbar buttons have proper titles
- Keyboard navigation fully supported

### Keyboard Navigation

- `Tab`: Navigate through UI elements
- `Space/Enter`: Toggle checkboxes and buttons
- `Escape`: Exit selection mode
- `Cmd/Ctrl + A`: Select all (when in mode)

### Screen Readers

- Selection count announced
- Action confirmations announced
- Mode changes announced

## Testing

### Unit Tests

**File**: `web-app/src/hooks/__tests__/useThreadSelection.test.ts`

Coverage:

- Selection mode toggle
- Single thread selection/deselection
- Range selection (shift-click)
- Select all functionality
- Clear selection
- Selection state queries

### Integration Tests

Recommended test scenarios:

1. Enter/exit selection mode
2. Select threads across different sections (favorites, recents, projects)
3. Bulk delete with confirmation
4. Bulk star/unstar
5. Assign multiple threads to project
6. Keyboard shortcuts functionality
7. Mobile responsiveness

## Localization

### Translation Keys

Add to your translation files:

```json
{
  "common": {
    "selectThread": "Select thread",
    "selected": "selected",
    "selectAll": "Select all",
    "multiSelectMode": {
      "enabled": "Multi-select mode enabled",
      "enter": "Select multiple",
      "exit": "Exit multi-select",
      "allSelected": "Selected {{count}} threads"
    },
    "bulkActions": {
      "deleteThreadsTitle": "Delete {{count}} threads?",
      "deleteThreadsDescription": "Are you sure you want to delete {{count}} thread(s)? This action cannot be undone.",
      "unstarThreadsTitle": "Remove {{count}} threads from favorites?",
      "unstarThreadsDescription": "Are you sure you want to remove {{count}} thread(s) from favorites?"
    },
    "toast": {
      "bulkDeleteThreads": {
        "title": "Deleted {{count}} threads",
        "description": "Successfully deleted {{count}} thread(s)",
        "error": "Failed to delete threads"
      },
      "bulkStarThreads": {
        "title": "Starred {{count}} threads",
        "description": "Successfully starred {{count}} thread(s)",
        "error": "Failed to star threads"
      },
      "bulkUnstarThreads": {
        "title": "Removed {{count}} threads from favorites",
        "description": "Successfully removed {{count}} thread(s) from favorites",
        "error": "Failed to unstar threads"
      },
      "bulkAssignProject": {
        "title": "Assigned {{count}} threads",
        "description": "Successfully assigned {{count}} thread(s) to \"{{projectName}}\"",
        "error": "Failed to assign threads to project"
      }
    }
  }
}
```

## Security Considerations

- **No Sensitive Data Logged**: Thread IDs only, no content
- **Confirmation Required**: Destructive operations require explicit confirmation
- **Undo Not Supported**: Users are warned before delete operations
- **Local Operations**: All selection state is client-side only

## Future Enhancements

### Potential Features

- [ ] Export multiple threads (JSON, Markdown, PDF)
- [ ] Duplicate multiple threads
- [ ] Move threads between projects (drag & drop)
- [ ] Advanced filters with multi-select
- [ ] Saved selections (bookmarks)
- [ ] Batch edit metadata
- [ ] Keyboard-only workflow mode

### Performance Improvements

- [ ] Virtual scrolling for large thread lists
- [ ] Lazy loading of thread metadata
- [ ] Progressive selection rendering

## Troubleshooting

### Common Issues

**Selection not working**

- Ensure you've entered selection mode (click checklist icon)
- Check if JavaScript errors in console
- Verify Zustand store is initialized

**Shift-click not selecting range**

- Make sure first thread is selected before shift-clicking
- Verify thread IDs are in the correct order
- Check `allThreadIds` prop is passed correctly

**Toolbar not appearing**

- Verify `BulkThreadActionsToolbar` is rendered in parent
- Check if `isSelectionMode` is true
- Ensure at least one thread is selected

**Keyboard shortcuts not working**

- Check if selection mode is active
- Verify event listeners are attached
- Check for keyboard event conflicts

## Contributing

When adding features to multi-select:

1. Update `useThreadSelection` hook if adding new selection behaviors
2. Add tests in `useThreadSelection.test.ts`
3. Update this README with new functionality
4. Add translation keys for new messages
5. Ensure accessibility standards are met
6. Test on multiple screen sizes

## License

This feature is part of the Jan project and follows the project's MIT license.
