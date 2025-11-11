# PHASE 2: Workspace ve Kurallar Sistemi

## 🎯 Amaç
Bu phase'de kullanıcının çalışma alanındaki dosyalarla güvenli şekilde etkileşim kurabilmesi ve AI modelinin davranışını yönlendiren kurallar sisteminin oluşturulması sağlanacak.

## 📋 Özellikler
1. ✅ .leah Klasör Yapısı ve Yönetimi
2. ✅ rules.md Sistemi (Kurallar Tanımlama)
3. ✅ Workspace File Operations (İzinli)
4. ✅ Rules Parser ve Enforcer
5. ✅ Rules GUI (Kural Oluşturma Arayüzü)
6. ✅ Örnek Kurallar Template'i

---

## 🏗️ Mimari Yapı

### 1. .leah Klasör Yapısı

```
workspace/
├── .leah/
│   ├── rules.md              # Kullanıcı kuralları
│   ├── rules.lock            # Parsed kurallar (JSON)
│   ├── todo.md               # Todo listesi (Phase 3'te)
│   ├── workspace.config.json # Workspace ayarları
│   └── history/              # Kural değişiklik geçmişi
│       ├── rules.2025-01-15.md
│       └── rules.2025-01-16.md
```

#### Workspace Config Schema
**Dosya:** `core/src/types/workspace/config.ts` (YENİ)
```typescript
export type WorkspaceConfig = {
  version: string
  workspace: {
    path: string
    name: string
    initialized: boolean
    createdAt: number
  }
  rules: {
    enabled: boolean
    strictMode: boolean  // Strict mode: kural ihlalinde işlem durdur
    autoSave: boolean
    lastModified: number
  }
  permissions: {
    fileOperations: {
      read: boolean
      write: boolean
      delete: boolean
      execute: boolean
    }
    allowedExtensions: string[]  // ['.js', '.ts', '.py', '.md', ...]
    excludedPaths: string[]      // ['node_modules', '.git', ...]
  }
  preferences: {
    preferredLanguage?: string
    preferredFramework?: string
    codeStyle?: string
  }
}
```

---

### 2. Rules Schema ve Parser

#### Rules Format (Markdown)
**Dosya:** `.leah/rules.md` (Template)
```markdown
# Project Rules

## 🚫 Yasaklar (Prohibitions)
Bu bölümde kesinlikle YAPILMAMASI gerekenler belirtilir.

- [ ] CDN kullanma, tüm dependencies lokal olmalı
- [ ] Inline styles yazma, her zaman CSS modülleri kullan
- [ ] console.log bırakma, production'a gitmemeli
- [ ] API keys kod içine yazma
- [ ] node_modules'ü commit etme

## ✅ Zorunluluklar (Requirements)
Bu bölümde MUTLAKA YAPILMASI gerekenler belirtilir.

- [x] Her fonksiyon için JSDoc yazılmalı
- [x] Tüm API calls error handling içermeli
- [x] Yeni özellikler test edilmeden commit edilmemeli
- [x] TypeScript strict mode kullanılmalı
- [x] Git commit messages conventional format'ta olmalı

## 📝 Kod Yazma Kuralları (Code Style)
Kod yazarken uyulması gereken stil kuralları.

### Genel Kurallar
- İndentasyon: 2 space
- Satır uzunluğu: max 100 karakter
- Trailing comma: her zaman kullan
- Semicolon: her zaman kullan

### TypeScript Kuralları
```typescript
// ✅ İYİ - Her zaman explicit type
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0)
}

// ❌ KÖTÜ - Implicit any
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0)
}
```

### React Kuralları
```typescript
// ✅ İYİ - Functional components, hooks
export function UserProfile({ userId }: Props) {
  const user = useUser(userId)
  return <div>{user.name}</div>
}

// ❌ KÖTÜ - Class components (eski)
export class UserProfile extends React.Component {
  render() {
    return <div>{this.props.user.name}</div>
  }
}
```

## 🗄️ Database Kuralları (Database Rules)
Database ile ilgili kurallar (varsa).

- [ ] Raw SQL yerine ORM kullan
- [ ] Migration'lar asla geri alınmamalı, yeni migration yaz
- [ ] Sensitive data encrypted olmalı
- [ ] Index'ler performans için eklenmeliimportant queries)

## 🎯 Tercih Edilen Teknolojiler (Preferred Technologies)

### Programlama Dili
- Primary: TypeScript
- Secondary: Python (scripts için)
- Avoid: JavaScript (use TypeScript instead)

### Frontend Framework
- Primary: React 19 + TypeScript
- State Management: Zustand
- Styling: TailwindCSS + CSS Modules
- Icons: Lucide React

### Backend Framework (eğer varsa)
- Primary: Node.js + Express
- Database: PostgreSQL
- ORM: Prisma

### Testing
- Unit Tests: Vitest
- E2E Tests: Playwright
- Coverage: min %80

## 🏗️ Mimari Kuralları (Architecture Rules)

- [ ] Monorepo yapısını koru
- [ ] Extension sistemi dışında core'u değiştirme
- [ ] Her yeni özellik için extension oluştur
- [ ] Shared types core/src/types altında
- [ ] Business logic extension'larda

## 📦 Dependencies

### Yeni Dependency Eklerken
1. Önce alternatiflerini araştır
2. Bundle size'ı kontrol et (< 100kb)
3. License uyumlu olmalı (MIT, Apache 2.0)
4. Aktif maintain edilmeli (son 6 ay içinde commit)
5. Security vulnerabilities yok olmalı

## 🧪 Testing Kuralları

- [ ] Her yeni feature için test yaz
- [ ] Bug fix yapıldığında regression test ekle
- [ ] Test coverage %80'in altına düşmemeli
- [ ] Integration testler CI/CD'de çalışmalı

## 📚 Dokümantasyon

- [ ] Public API'ler için TSDoc yaz
- [ ] README güncel tut
- [ ] Breaking changes CHANGELOG'a ekle
- [ ] Complex logic için inline comment
```

#### Parsed Rules Schema
**Dosya:** `core/src/types/workspace/rules.ts` (YENİ)
```typescript
export type RuleType = 'prohibition' | 'requirement' | 'style' | 'preference' | 'architecture'

export type Rule = {
  id: string
  type: RuleType
  category: string
  description: string
  checked: boolean
  priority: 'high' | 'medium' | 'low'
  examples?: {
    good?: string[]
    bad?: string[]
  }
  enforcement: {
    enabled: boolean
    action: 'warn' | 'block' | 'suggest'
  }
}

export type RuleSet = {
  version: string
  lastModified: number
  rules: Rule[]
  preferences: {
    preferredLanguage?: string
    preferredFramework?: string
    codeStyle?: Record<string, any>
  }
}

export type RuleViolation = {
  ruleId: string
  severity: 'error' | 'warning' | 'info'
  message: string
  context?: string
  suggestion?: string
  timestamp: number
}
```

#### Rules Parser
**Dosya:** `core/src/browser/extensions/workspace/rules-parser.ts` (YENİ)
```typescript
export class RulesParser {
  /**
   * Parse markdown rules file to structured RuleSet
   */
  parse(markdownContent: string): RuleSet {
    // 1. Parse markdown using unified/remark
    // 2. Extract sections (Yasaklar, Zorunluluklar, etc.)
    // 3. Parse checkboxes and code examples
    // 4. Generate rule IDs
    // 5. Return structured RuleSet
  }

  /**
   * Convert RuleSet back to markdown
   */
  stringify(ruleSet: RuleSet): string {
    // Reverse operation
  }

  /**
   * Validate rules syntax
   */
  validate(markdownContent: string): {
    valid: boolean
    errors: Array<{ line: number, message: string }>
  } {
    // Check markdown structure
    // Ensure required sections exist
    // Validate code examples syntax
  }
}
```

---

### 3. Workspace File Operations Extension

#### Extension Definition
**Dosya:** `core/src/browser/extensions/workspace/workspace-manager.ts` (YENİ)
```typescript
import { BaseExtension, ExtensionTypeEnum } from '../extension'

export type FileOperation = {
  id: string
  type: 'read' | 'write' | 'delete' | 'rename' | 'create'
  path: string
  content?: string
  timestamp: number
  approved: boolean
  executedBy: 'user' | 'ai'
}

export type PermissionRequest = {
  id: string
  operation: FileOperation
  reason: string
  status: 'pending' | 'approved' | 'denied'
  requestedAt: number
  respondedAt?: number
}

export abstract class WorkspaceManagerExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.WorkspaceManager
  }

  // Workspace Initialization
  abstract initWorkspace(path: string): Promise<WorkspaceConfig>
  abstract loadWorkspace(path: string): Promise<WorkspaceConfig>
  abstract isWorkspaceInitialized(path: string): Promise<boolean>

  // Rules Management
  abstract loadRules(): Promise<RuleSet>
  abstract saveRules(rules: RuleSet): Promise<void>
  abstract validateRules(markdownContent: string): Promise<ValidationResult>
  abstract createDefaultRules(): Promise<string>

  // File Operations (Permission-based)
  abstract requestFileOperation(operation: FileOperation, reason: string): Promise<PermissionRequest>
  abstract executeFileOperation(operationId: string): Promise<void>
  abstract listFiles(pattern?: string): Promise<string[]>
  abstract readFile(path: string): Promise<string>
  abstract writeFile(path: string, content: string): Promise<void>
  abstract deleteFile(path: string): Promise<void>

  // Permission Management
  abstract getPendingRequests(): Promise<PermissionRequest[]>
  abstract approveRequest(requestId: string): Promise<void>
  abstract denyRequest(requestId: string, reason?: string): Promise<void>
}
```

---

### 4. Rules Enforcement Engine

#### Rules Enforcer
**Dosya:** `extensions/workspace-extension/src/rules-enforcer.ts` (YENİ)
```typescript
export class RulesEnforcer {
  private rules: RuleSet

  /**
   * Check if a proposed code/action violates any rules
   */
  async checkViolations(input: {
    type: 'code' | 'file_operation' | 'commit'
    content: string
    metadata?: Record<string, any>
  }): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = []

    // 1. Check prohibitions
    violations.push(...this.checkProhibitions(input))

    // 2. Check requirements
    violations.push(...this.checkRequirements(input))

    // 3. Check style rules
    violations.push(...this.checkStyleRules(input))

    return violations
  }

  /**
   * Suggest fixes for violations
   */
  async suggestFixes(violation: RuleViolation): Promise<string[]> {
    // Use AI to suggest fixes based on rules
  }

  /**
   * Augment AI prompt with rules
   */
  augmentPrompt(originalPrompt: string): string {
    const rulesContext = this.generateRulesContext()
    return `${rulesContext}\n\n${originalPrompt}`
  }

  private generateRulesContext(): string {
    return `
You must follow these project rules:

PROHIBITIONS (Never do these):
${this.rules.rules
  .filter(r => r.type === 'prohibition')
  .map(r => `- ${r.description}`)
  .join('\n')}

REQUIREMENTS (Always do these):
${this.rules.rules
  .filter(r => r.type === 'requirement')
  .map(r => `- ${r.description}`)
  .join('\n')}

PREFERRED TECHNOLOGIES:
- Language: ${this.rules.preferences.preferredLanguage || 'Not specified'}
- Framework: ${this.rules.preferences.preferredFramework || 'Not specified'}
`
  }
}
```

---

### 5. UI Components

#### Rules Editor
**Dosya:** `web-app/src/routes/workspace/rules.tsx` (YENİ)
```typescript
export function RulesEditor() {
  // Split view: Markdown editor (left) + Preview (right)
  // Live validation
  // Syntax highlighting
  // Save/Load buttons
  // Import/Export
  // Version history

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="editor-panel">
        <MarkdownEditor />
      </div>
      <div className="preview-panel">
        <RulesPreview />
      </div>
    </div>
  )
}
```

#### Rules Creation Wizard
**Dosya:** `web-app/src/components/workspace/RulesWizard.tsx` (YENİ)
```typescript
export function RulesWizard() {
  // Step 1: Project Type Selection (web, backend, mobile, etc.)
  // Step 2: Programming Language
  // Step 3: Framework
  // Step 4: Custom Rules (optional)
  // Step 5: Review & Generate

  // Generates a customized rules.md based on selections
}
```

#### File Operation Permission Dialog
**Dosya:** `web-app/src/components/workspace/PermissionDialog.tsx` (YENİ)
```typescript
export function PermissionDialog({ request }: { request: PermissionRequest }) {
  // Show operation details
  // Show reason from AI
  // Show file diff (for write operations)
  // Approve/Deny buttons
  // "Remember my choice" checkbox

  return (
    <Dialog>
      <DialogContent>
        <h2>Permission Required</h2>
        <p>AI wants to: {request.operation.type}</p>
        <p>File: {request.operation.path}</p>
        <p>Reason: {request.reason}</p>

        {request.operation.type === 'write' && (
          <DiffViewer
            oldContent={currentFileContent}
            newContent={request.operation.content}
          />
        )}

        <div className="actions">
          <Button onClick={approve}>Approve</Button>
          <Button variant="destructive" onClick={deny}>Deny</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

#### Rules Violation Indicator
**Dosya:** `web-app/src/containers/RulesViolationIndicator.tsx` (YENİ)
```typescript
export function RulesViolationIndicator({ threadId }: { threadId: string }) {
  // Show rules violations in current conversation
  // Grouped by severity
  // Click to see details and suggestions

  const violations = useRulesViolations(threadId)

  return (
    <div className="violations-indicator">
      {violations.length > 0 && (
        <Badge variant="warning">
          {violations.length} Rule Violations
        </Badge>
      )}
    </div>
  )
}
```

#### Workspace Setup Screen
**Dosya:** `web-app/src/routes/workspace/setup.tsx` (YENİ)
```typescript
export function WorkspaceSetup() {
  // 1. Select workspace folder
  // 2. Initialize .leah structure
  // 3. Run rules wizard
  // 4. Set permissions
  // 5. Complete setup

  return <SetupWizard steps={setupSteps} />
}
```

---

## 📁 Değiştirilecek/Oluşturulacak Dosyalar

### YENİ DOSYALAR

#### Core
1. `core/src/types/workspace/config.ts` - Workspace config types
2. `core/src/types/workspace/rules.ts` - Rules types
3. `core/src/browser/extensions/workspace/workspace-manager.ts` - Workspace extension interface
4. `core/src/browser/extensions/workspace/rules-parser.ts` - Rules parser
5. `core/src/browser/extensions/workspace/rules-enforcer.ts` - Rules enforcer

#### Extension
6. `extensions/workspace-extension/` - Komple yeni extension
   - `src/index.ts`
   - `src/workspace-manager-impl.ts`
   - `src/rules-parser.ts`
   - `src/rules-enforcer.ts`
   - `src/file-operations.ts`
   - `src/permission-manager.ts`
   - `package.json`

#### Web App
7. `web-app/src/routes/workspace/setup.tsx` - Workspace setup wizard
8. `web-app/src/routes/workspace/rules.tsx` - Rules editor
9. `web-app/src/routes/workspace/index.tsx` - Workspace dashboard
10. `web-app/src/components/workspace/RulesWizard.tsx` - Rules creation wizard
11. `web-app/src/components/workspace/RulesEditor.tsx` - Markdown editor
12. `web-app/src/components/workspace/RulesPreview.tsx` - Rules preview
13. `web-app/src/components/workspace/PermissionDialog.tsx` - Permission request dialog
14. `web-app/src/components/workspace/FileTree.tsx` - Workspace file tree
15. `web-app/src/containers/RulesViolationIndicator.tsx` - Violations indicator
16. `web-app/src/hooks/useWorkspace.ts` - Workspace hook
17. `web-app/src/hooks/useRules.ts` - Rules hook
18. `web-app/src/hooks/useFileOperations.ts` - File operations hook
19. `web-app/src/services/workspace/index.ts` - Workspace service

#### Templates
20. `.leah/templates/rules.template.md` - Default rules template
21. `.leah/templates/rules-web.template.md` - Web project template
22. `.leah/templates/rules-backend.template.md` - Backend project template

### GÜNCELLENECEKETİ DOSYALAR
1. `core/src/browser/extensions/inference.ts` - Rules enforcement entegrasyonu
2. `web-app/src/containers/ThreadList.tsx` - Workspace indicator
3. `web-app/src/routes/settings/general.tsx` - Workspace settings bölümü

---

## 🔄 İş Akışı

### 1. Workspace Initialization
```
Kullanıcı → Settings → Workspace → Initialize
→ Folder seç
→ .leah klasörü oluştur
→ Rules wizard başlat
→ Template seç (Web/Backend/Mobile/Custom)
→ Customization (optional)
→ Generate rules.md
→ Set permissions
→ Complete
```

### 2. Rules Enforcement Flow
```
AI wants to generate code
→ RulesEnforcer.checkViolations()
→ If violations found:
  → Show warning to user
  → Suggest fixes
  → Ask for confirmation
  → If strict mode: block operation
  → Else: allow with warning
→ If no violations:
  → Proceed normally
```

### 3. File Operation Flow
```
AI wants to write file
→ WorkspaceManager.requestFileOperation()
→ Check permissions in config
→ If auto-approve enabled:
  → Execute immediately
→ Else:
  → Show PermissionDialog
  → Wait for user decision
  → If approved: execute
  → If denied: cancel and inform AI
→ Log operation
```

### 4. Rules Modification
```
Kullanıcı → Workspace → Rules
→ Edit rules.md (markdown editor)
→ Live validation
→ Save
→ Parse to RuleSet
→ Update rules.lock
→ Backup old rules to history/
→ Notify active threads
```

---

## ⚡ Performans Optimizasyonları

### 1. Rules Parsing
- Parse rules once on load, cache in memory
- Invalidate cache only on rules.md change
- Use incremental parsing for large rulesets

### 2. File Operations
- Batch file reads/writes
- Use file watchers for auto-refresh
- Cache file tree structure

### 3. Rules Enforcement
- Run rules check asynchronously
- Don't block UI on violation check
- Debounce checks during typing

### 4. Memory Management
- Limit history/ to last 30 days
- Compress old rules backups
- Clear operation logs > 7 days

---

## 🧪 Test Planı

### Unit Tests
- [ ] Rules parser accuracy (100% coverage)
- [ ] Rules enforcer violation detection
- [ ] File operation permission logic
- [ ] Workspace initialization

### Integration Tests
- [ ] End-to-end workspace setup
- [ ] Rules enforcement in inference flow
- [ ] File operations with permissions
- [ ] Rules modification and reload

### E2E Tests
- [ ] User creates workspace
- [ ] User edits rules via UI
- [ ] AI requests file operation
- [ ] AI violates rule, gets blocked/warned

---

## 📊 Başarı Kriterleri

1. ✅ Kullanıcı 5 dakikadan kısa sürede workspace kurabilmeli
2. ✅ Rules parsing < 100ms olmalı
3. ✅ Rules violation check < 50ms olmalı
4. ✅ File operation permission dialog 1 saniyeden hızlı açılmalı
5. ✅ AI, %95+ doğrulukla kurallara uymalı
6. ✅ Rules editor lag-free çalışmalı (60fps)

---

## 🚀 Implementation Sırası

1. **Gün 1-2:** Type definitions ve workspace config
2. **Gün 3-4:** Rules parser implementasyonu
3. **Gün 5-6:** Workspace manager extension
4. **Gün 7-8:** Rules enforcer ve violation detection
5. **Gün 9-10:** File operations ve permission system
6. **Gün 11-12:** UI components (wizard, editor, dialogs)
7. **Gün 13-14:** Templates ve default rules
8. **Gün 15-16:** Inference integration (rules injection)
9. **Gün 17-18:** Testing ve optimization
10. **Gün 19-20:** Bug fixes ve polish

---

## 🔗 Dependencies

### NPM Packages (Yeni)
```json
{
  "dependencies": {
    "unified": "^11.0.4",           // Markdown processing
    "remark-parse": "^11.0.0",       // Markdown parser
    "remark-stringify": "^11.0.0",   // Markdown generator
    "chokidar": "^3.5.3",           // File watcher
    "fast-glob": "^3.3.2",          // File pattern matching
    "diff": "^5.1.0",               // File diffing
    "@codemirror/lang-markdown": "^6.2.4",  // Markdown editor
    "yaml-front-matter": "^4.1.1"   // Frontmatter parsing
  }
}
```

---

## 📝 Example Rules Templates

### Web Project Template
```markdown
# Web Project Rules

## 🚫 Yasaklar
- [ ] CDN kullanma
- [ ] Inline styles
- [ ] console.log in production

## ✅ Zorunluluklar
- [x] TypeScript strict mode
- [x] ESLint + Prettier
- [x] Unit tests for components

## 🎯 Preferred Technologies
- Language: TypeScript
- Framework: React + TailwindCSS
- State: Zustand
- Testing: Vitest + Testing Library
```

### Backend Project Template
```markdown
# Backend Project Rules

## 🚫 Yasaklar
- [ ] SQL injection vulnerabilities
- [ ] Hardcoded credentials
- [ ] Blocking operations in routes

## ✅ Zorunluluklar
- [x] Input validation
- [x] Error handling middleware
- [x] API documentation (OpenAPI)

## 🎯 Preferred Technologies
- Language: TypeScript
- Framework: Express.js
- Database: PostgreSQL + Prisma
- Testing: Jest + Supertest
```

---

## ⚠️ Dikkat Edilecekler

1. **Security:** File operations sandboxed olmalı, workspace dışına çıkmamalı
2. **Performance:** Rules parsing her request'te değil, sadece değiştiğinde
3. **UX:** Permission dialogs intrusive olmamalı, smart defaults olmalı
4. **Validation:** Rules syntax errors user-friendly şekilde gösterilmeli
5. **Backup:** Rules değişiklikleri otomatik backup'lanmalı
6. **Compatibility:** Farklı OS'lerde path handling doğru yapılmalı

---

## 🎯 Next Phase Preview

**Phase 3: Todo Sistemi**
- .leah/todo.md yapısı
- Phase-based execution
- Todo GUI ve editor
- Progress tracking ve reporting
