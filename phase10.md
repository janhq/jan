# PHASE 10: Gelişmiş UI/UX

## 🎯 Amaç
Kullanıcı deneyimini üst seviyeye çıkarmak için modern, hızlı ve görsel olarak çekici bir arayüz oluşturmak.

## 📋 Özellikler
1. ✅ Multi-Panel Layout (Sidebar, Main, Inspector)
2. ✅ Tabs/Sekmeler Sistemi
3. ✅ Glass/Blur Effects
4. ✅ Smooth Animations (Framer Motion)
5. ✅ Advanced Settings Panel
6. ✅ Charts & Visualizations
7. ✅ Dark/Light Theme (Enhanced)
8. ✅ Responsive Design (Mobile-first)
9. ✅ Keyboard Shortcuts
10. ✅ Customizable Layouts

---

## 🏗️ Mimari Yapı

### 1. Layout System

**Dosya:** `web-app/src/layouts/MainLayout.tsx` (GÜNCELLENECEK)
```typescript
export function MainLayout() {
  return (
    <div className="main-layout h-screen flex">
      {/* Sidebar (Collapsible) */}
      <Sidebar
        collapsible
        defaultWidth={280}
        minWidth={240}
        maxWidth={400}
        className="glass-panel"
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <TopBar className="glass-panel" />

        {/* Content with Tabs */}
        <TabsContainer>
          {openTabs.map(tab => (
            <TabContent key={tab.id} tab={tab} />
          ))}
        </TabsContainer>

        {/* Bottom Status Bar */}
        <StatusBar className="glass-panel" />
      </div>

      {/* Inspector Panel (Right) */}
      <InspectorPanel
        collapsible
        defaultWidth={320}
        className="glass-panel"
      />
    </div>
  )
}
```

---

### 2. Panel System (Resizable Panels)

**Using:** `react-resizable-panels`

```typescript
// panels/ResizablePanelLayout.tsx
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

export function ResizablePanelLayout() {
  return (
    <PanelGroup direction="horizontal">
      {/* Sidebar */}
      <Panel defaultSize={20} minSize={15} maxSize={30}>
        <SidebarContent />
      </Panel>

      <PanelResizeHandle className="resize-handle" />

      {/* Main Content */}
      <Panel defaultSize={55} minSize={40}>
        <MainContent />
      </Panel>

      <PanelResizeHandle className="resize-handle" />

      {/* Inspector */}
      <Panel defaultSize={25} minSize={20} maxSize={35}>
        <InspectorContent />
      </Panel>
    </PanelGroup>
  )
}
```

---

### 3. Tabs System

**Dosya:** `web-app/src/components/tabs/TabsManager.tsx` (YENİ)
```typescript
export type Tab = {
  id: string
  type: 'chat' | 'settings' | 'monitoring' | 'rag' | 'agent' | 'prompts'
  title: string
  icon?: React.ReactNode
  closable: boolean
  data?: any
}

export function TabsManager() {
  const { tabs, activeTabId, openTab, closeTab, switchTab } = useTabs()

  return (
    <div className="tabs-container">
      {/* Tab Bar */}
      <div className="tab-bar glass-panel">
        <DndContext onDragEnd={handleTabReorder}>
          <SortableContext items={tabs.map(t => t.id)}>
            {tabs.map(tab => (
              <SortableTab
                key={tab.id}
                tab={tab}
                active={tab.id === activeTabId}
                onClick={() => switchTab(tab.id)}
                onClose={() => closeTab(tab.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* New Tab Button */}
        <Button
          size="sm"
          variant="ghost"
          onClick={openNewTabMenu}
        >
          <PlusIcon />
        </Button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        <AnimatePresence mode="wait">
          {tabs.map(tab => (
            tab.id === activeTabId && (
              <motion.div
                key={tab.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <TabContentRenderer tab={tab} />
              </motion.div>
            )
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
```

---

### 4. Glass/Blur Effects

**Dosya:** `web-app/src/styles/glass.css` (YENİ)
```css
/* Glass Panel */
.glass-panel {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px) saturate(180%);
  -webkit-backdrop-filter: blur(10px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

/* Dark mode */
.dark .glass-panel {
  background: rgba(17, 24, 39, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

/* Frosted Glass Card */
.glass-card {
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(15px);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow:
    0 8px 32px rgba(31, 38, 135, 0.15),
    inset 0 1px 1px rgba(255, 255, 255, 0.4);
}

/* Gradient Glass */
.glass-gradient {
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.7),
    rgba(255, 255, 255, 0.4)
  );
  backdrop-filter: blur(10px);
}

/* Hover Effects */
.glass-hover {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.glass-hover:hover {
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}
```

---

### 5. Animations (Framer Motion)

**Dosya:** `web-app/src/components/animations/AnimatedComponents.tsx` (YENİ)
```typescript
import { motion } from 'framer-motion'

// Fade In Up
export const FadeInUp = ({ children, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay }}
  >
    {children}
  </motion.div>
)

// Scale In
export const ScaleIn = ({ children }) => (
  <motion.div
    initial={{ scale: 0.9, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    transition={{ duration: 0.3 }}
  >
    {children}
  </motion.div>
)

// Slide In from Side
export const SlideIn = ({ children, direction = 'left' }) => {
  const variants = {
    left: { x: -100 },
    right: { x: 100 },
    top: { y: -100 },
    bottom: { y: 100 }
  }

  return (
    <motion.div
      initial={{ ...variants[direction], opacity: 0 }}
      animate={{ x: 0, y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 100, damping: 15 }}
    >
      {children}
    </motion.div>
  )
}

// Stagger Children
export const StaggerContainer = ({ children }) => (
  <motion.div
    initial="hidden"
    animate="visible"
    variants={{
      visible: {
        transition: {
          staggerChildren: 0.1
        }
      }
    }}
  >
    {children}
  </motion.div>
)

// Page Transition
export const PageTransition = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.95 }}
    transition={{ duration: 0.2 }}
  >
    {children}
  </motion.div>
)
```

---

### 6. Advanced Settings Panel

**Dosya:** `web-app/src/routes/settings/advanced.tsx` (YENİ)
```typescript
export function AdvancedSettings() {
  return (
    <div className="advanced-settings space-y-6">
      {/* Interface Customization */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Interface Customization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Layout Preset */}
          <div>
            <Label>Layout Preset</Label>
            <Select value={layoutPreset} onChange={setLayoutPreset}>
              <option value="default">Default</option>
              <option value="compact">Compact</option>
              <option value="spacious">Spacious</option>
              <option value="focus">Focus Mode</option>
            </Select>
          </div>

          {/* Panel Positions */}
          <div>
            <Label>Sidebar Position</Label>
            <RadioGroup value={sidebarPosition} onChange={setSidebarPosition}>
              <Radio value="left">Left</Radio>
              <Radio value="right">Right</Radio>
            </RadioGroup>
          </div>

          {/* Theme Customization */}
          <div>
            <Label>Primary Color</Label>
            <ColorPicker value={primaryColor} onChange={setPrimaryColor} />
          </div>

          {/* Font Size */}
          <div>
            <Label>Font Size: {fontSize}px</Label>
            <Slider
              value={fontSize}
              onChange={setFontSize}
              min={12}
              max={20}
              step={1}
            />
          </div>

          {/* Animation Speed */}
          <div>
            <Label>Animation Speed</Label>
            <Select value={animationSpeed} onChange={setAnimationSpeed}>
              <option value="slow">Slow</option>
              <option value="normal">Normal</option>
              <option value="fast">Fast</option>
              <option value="none">Disabled</option>
            </Select>
          </div>

          {/* Glass Effect Intensity */}
          <div>
            <Label>Glass Effect: {glassIntensity}%</Label>
            <Slider
              value={glassIntensity}
              onChange={setGlassIntensity}
              min={0}
              max={100}
              step={10}
            />
          </div>
        </CardContent>
      </Card>

      {/* Keyboard Shortcuts */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Keyboard Shortcuts</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyboardShortcutsTable shortcuts={shortcuts} onEdit={editShortcut} />
        </CardContent>
      </Card>

      {/* Experimental Features */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Experimental Features</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Checkbox checked={enableGPUAcceleration} onChange={setEnableGPUAcceleration}>
            Enable GPU Acceleration
          </Checkbox>
          <Checkbox checked={enableVirtualScrolling} onChange={setEnableVirtualScrolling}>
            Enable Virtual Scrolling
          </Checkbox>
          <Checkbox checked={enableAcrylic} onChange={setEnableAcrylic}>
            Enable Acrylic Effect (Windows)
          </Checkbox>
        </CardContent>
      </Card>
    </div>
  )
}
```

---

### 7. Inspector Panel

**Dosya:** `web-app/src/components/inspector/InspectorPanel.tsx` (YENİ)
```typescript
export function InspectorPanel() {
  const { activeTab, selection } = useInspector()

  return (
    <div className="inspector-panel glass-panel">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="properties">
          {selection?.type === 'message' && (
            <MessageProperties message={selection.data} />
          )}
          {selection?.type === 'model' && (
            <ModelProperties model={selection.data} />
          )}
        </TabsContent>

        <TabsContent value="stats">
          <StatisticsView />
        </TabsContent>

        <TabsContent value="history">
          <HistoryView />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

---

### 8. Status Bar

**Dosya:** `web-app/src/components/layout/StatusBar.tsx` (YENİ)
```typescript
export function StatusBar() {
  return (
    <div className="status-bar glass-panel flex items-center justify-between px-4 py-2 text-sm">
      {/* Left Side */}
      <div className="flex items-center space-x-4">
        {/* Connection Status */}
        <div className="flex items-center space-x-2">
          <div className={cn('w-2 h-2 rounded-full', {
            'bg-green-500': isConnected,
            'bg-red-500': !isConnected
          })} />
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {/* Active Model */}
        <div className="flex items-center space-x-2">
          <CpuIcon className="w-4 h-4" />
          <span>{activeModel}</span>
        </div>

        {/* Token Count */}
        <div className="flex items-center space-x-2">
          <HashIcon className="w-4 h-4" />
          <span>{tokenCount} tokens</span>
        </div>
      </div>

      {/* Right Side */}
      <div className="flex items-center space-x-4">
        {/* Response Time */}
        <div className="flex items-center space-x-2">
          <ClockIcon className="w-4 h-4" />
          <span>{responseTime}ms</span>
        </div>

        {/* Memory Usage */}
        <div className="flex items-center space-x-2">
          <MemoryIcon className="w-4 h-4" />
          <span>{memoryUsage}%</span>
        </div>

        {/* Zoom */}
        <div className="flex items-center space-x-2">
          <Button size="sm" variant="ghost" onClick={zoomOut}>−</Button>
          <span>{zoom}%</span>
          <Button size="sm" variant="ghost" onClick={zoomIn}>+</Button>
        </div>
      </div>
    </div>
  )
}
```

---

### 9. Keyboard Shortcuts

**Dosya:** `web-app/src/hooks/useKeyboardShortcuts.ts` (YENİ)
```typescript
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + K: Command Palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        openCommandPalette()
      }

      // Ctrl/Cmd + T: New Tab
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault()
        openNewTab()
      }

      // Ctrl/Cmd + W: Close Tab
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault()
        closeActiveTab()
      }

      // Ctrl/Cmd + Tab: Next Tab
      if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
        e.preventDefault()
        nextTab()
      }

      // Ctrl/Cmd + B: Toggle Sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }

      // Ctrl/Cmd + /: Toggle Inspector
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        toggleInspector()
      }

      // Esc: Close dialogs
      if (e.key === 'Escape') {
        closeAllDialogs()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
```

---

### 10. Command Palette

**Dosya:** `web-app/src/components/command/CommandPalette.tsx` (YENİ)
```typescript
export function CommandPalette() {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="glass-panel max-w-2xl">
        <Command>
          <CommandInput
            placeholder="Type a command or search..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            <CommandGroup heading="Navigation">
              <CommandItem onSelect={() => navigate('/chat')}>
                <MessageSquareIcon />
                <span>Go to Chat</span>
              </CommandItem>
              <CommandItem onSelect={() => navigate('/settings')}>
                <SettingsIcon />
                <span>Open Settings</span>
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="Actions">
              <CommandItem onSelect={createNewChat}>
                <PlusIcon />
                <span>New Chat</span>
                <CommandShortcut>⌘T</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={exportConversation}>
                <DownloadIcon />
                <span>Export Conversation</span>
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="Models">
              {models.map(model => (
                <CommandItem key={model.id} onSelect={() => switchModel(model)}>
                  <CpuIcon />
                  <span>{model.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
```

---

## 📁 Yeni/Güncellenecek Dosyalar

### Layouts
1. `web-app/src/layouts/MainLayout.tsx` (GÜNCELLENECEK)
2. `web-app/src/layouts/panels/ResizablePanelLayout.tsx` (YENİ)

### Components
3. `web-app/src/components/tabs/TabsManager.tsx` (YENİ)
4. `web-app/src/components/tabs/SortableTab.tsx` (YENİ)
5. `web-app/src/components/inspector/InspectorPanel.tsx` (YENİ)
6. `web-app/src/components/layout/StatusBar.tsx` (YENİ)
7. `web-app/src/components/layout/TopBar.tsx` (GÜNCELLENECEK)
8. `web-app/src/components/command/CommandPalette.tsx` (YENİ)
9. `web-app/src/components/animations/AnimatedComponents.tsx` (YENİ)

### Styles
10. `web-app/src/styles/glass.css` (YENİ)
11. `web-app/src/styles/animations.css` (YENİ)

### Hooks
12. `web-app/src/hooks/useTabs.ts` (YENİ)
13. `web-app/src/hooks/useKeyboardShortcuts.ts` (YENİ)
14. `web-app/src/hooks/useCommandPalette.ts` (YENİ)

### Routes
15. `web-app/src/routes/settings/advanced.tsx` (YENİ)
16. `web-app/src/routes/settings/appearance.tsx` (GÜNCELLENECEK)

---

## 🎨 Design System Updates

### Color Palette
```css
/* Primary */
--primary: 220 90% 56%;
--primary-foreground: 210 40% 98%;

/* Glass Effect Variables */
--glass-bg: rgba(255, 255, 255, 0.7);
--glass-border: rgba(255, 255, 255, 0.3);
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
--glass-blur: blur(10px);

/* Animations */
--animation-duration-fast: 150ms;
--animation-duration-normal: 300ms;
--animation-duration-slow: 500ms;
--animation-timing: cubic-bezier(0.4, 0, 0.2, 1);
```

---

## ⚡ Performans Optimizasyonları

1. **Virtual Scrolling:** Uzun listeler için (1000+ items)
2. **Code Splitting:** Route-based lazy loading
3. **Memoization:** React.memo, useMemo, useCallback
4. **GPU Acceleration:** transform ve opacity animasyonları
5. **Debouncing:** Search, resize events
6. **Image Optimization:** WebP format, lazy loading

---

## 📱 Responsive Design

- **Mobile (< 768px):** Single column, bottom nav
- **Tablet (768px - 1024px):** 2 columns, collapsible sidebars
- **Desktop (> 1024px):** Full 3-panel layout
- **Ultra-wide (> 1920px):** 4-panel option

---

## 🚀 Implementation: 12-14 gün

1. **Gün 1-2:** Multi-panel layout, resizable panels
2. **Gün 3-4:** Tabs system (drag-and-drop)
3. **Gün 5-6:** Glass effects, animations
4. **Gün 7-8:** Inspector panel, status bar
5. **Gün 9-10:** Command palette, keyboard shortcuts
6. **Gün 11-12:** Advanced settings, customization
7. **Gün 13-14:** Polish, responsive design, optimization

---

## 📊 Başarı Kriterleri

1. ✅ UI render < 16ms (60fps)
2. ✅ Panel resize lag-free
3. ✅ Animations smooth (60fps)
4. ✅ Tab switching < 100ms
5. ✅ Command palette search < 50ms
6. ✅ Keyboard shortcuts response < 50ms
7. ✅ Mobile responsive, touch-friendly

---

## 🎯 Final Notes

Bu 10 phase tamamlandığında Jan, tam donanımlı bir AI platform olacak:

✅ **Phase 1:** Multi-API support, token tracking
✅ **Phase 2:** Workspace, rules system
✅ **Phase 3:** Todo system, phase execution
✅ **Phase 4:** Multi-model chat, comparison
✅ **Phase 5:** RAG system, document querying
✅ **Phase 6:** Professional prompt templates
✅ **Phase 7:** Performance monitoring, benchmarks
✅ **Phase 8:** Autonomous agent system
✅ **Phase 9:** Import/export, batch processing
✅ **Phase 10:** Modern, beautiful UI/UX

**Toplam Tahmini Süre:** 120-140 gün (4-5 ay)
**Önerilen Yaklaşım:** Phase'leri sırayla, test ederek ilerle

Her phase bağımsız test edilebilir ve production'a alınabilir.
