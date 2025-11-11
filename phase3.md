# PHASE 3: Todo Sistemi

## 🎯 Amaç
Bu phase'de kullanıcının AI'a phase-based (aşamalı) görevler verebilmesi, ilerleyişi takip edebilmesi ve AI'ın belirlenen sıraya göre otomatik çalışabilmesi sağlanacak.

## 📋 Özellikler
1. ✅ .leah/todo.md Yapısı ve Formatı
2. ✅ Todo Parser ve Executor
3. ✅ Phase-based Execution Engine
4. ✅ Progress Tracking ve Reporting
5. ✅ Todo GUI (Oluşturma, Düzenleme, Takip)
6. ✅ Conditional Logic Support (if-then-else)
7. ✅ Error Handling ve Retry Mechanism

---

## 🏗️ Mimari Yapı

### 1. Todo Format Specification

#### .leah/todo.md Format
```markdown
# Project Todo List

**Project:** Jan AI Platform Enhancement
**Created:** 2025-01-15
**Status:** In Progress
**Current Phase:** 2/5

---

## 📋 Phase 1: Database Migration
**Status:** ✅ Completed
**Duration:** 2h 30m
**Completed:** 2025-01-15 14:30

### Tasks
- [x] Backup existing database
- [x] Create migration scripts
- [x] Test migration on staging
- [x] Run migration on production
- [x] Verify data integrity

### Success Criteria
- [x] All data migrated without loss
- [x] Application working normally
- [x] Performance not degraded

### Notes
Migration completed successfully. No data loss detected.

---

## 📋 Phase 2: API Refactoring
**Status:** 🔄 In Progress
**Started:** 2025-01-15 15:00
**Progress:** 60%

### Tasks
- [x] Read .leah/rules.md lines 122-150
- [x] Identify deprecated endpoints
- [ ] Update endpoint implementations
- [ ] Write unit tests
- [ ] Update API documentation

### Instructions
```
1. Read rules.md to understand API standards
2. For each endpoint:
   - Check if follows REST conventions
   - Ensure proper error handling
   - Add rate limiting
3. Test each endpoint thoroughly
4. If tests fail:
   - Log the error
   - Fix the issue
   - Re-run tests
5. Only proceed to Phase 3 if all tests pass
```

### Success Criteria
- [ ] All endpoints follow REST conventions
- [ ] 100% test coverage
- [ ] Response time < 200ms
- [ ] Proper error messages

### On Failure
```
If any test fails:
1. Log detailed error information
2. Check .leah/rules.md for API standards
3. Fix the failing endpoint
4. Re-run all tests
5. Do NOT proceed to next phase until all tests pass
```

---

## 📋 Phase 3: Frontend Integration
**Status:** ⏳ Pending
**Depends On:** Phase 2

### Tasks
- [ ] Update API client
- [ ] Modify UI components
- [ ] Test user flows
- [ ] Deploy to staging

### Conditional Logic
```
IF Phase 2 test coverage < 100%:
  - Go back to Phase 2
  - Add missing tests
  - THEN proceed to Phase 3
ELSE:
  - Start Phase 3 tasks
END IF

IF deployment fails:
  - Rollback changes
  - Check deployment logs at /logs/deploy.log
  - Fix issues
  - Retry deployment
END IF
```

---

## 📋 Phase 4: Performance Testing
**Status:** ⏳ Pending
**Depends On:** Phase 3

### Tasks
- [ ] Run load tests
- [ ] Analyze bottlenecks
- [ ] Optimize slow queries
- [ ] Re-test

### Success Criteria
- [ ] API response time < 200ms (p95)
- [ ] Supports 1000 concurrent users
- [ ] No memory leaks

---

## 📋 Phase 5: Documentation & Deployment
**Status:** ⏳ Pending
**Depends On:** Phase 4

### Tasks
- [ ] Update README.md
- [ ] Generate API documentation
- [ ] Create deployment guide
- [ ] Deploy to production
- [ ] Monitor for 24 hours

### Final Report
```
Create a report in workspace/report_{{DATE}}.md with:
- Summary of all phases
- Time taken for each phase
- Issues encountered and resolutions
- Performance metrics
- Lessons learned
```

---

## 📊 Overall Progress
- Total Phases: 5
- Completed: 1
- In Progress: 1
- Pending: 3
- Estimated Completion: 2025-01-18

## 🚨 Blockers
- None currently

## 📝 Notes
- Remember to follow .leah/rules.md at all times
- Test thoroughly before moving to next phase
- Document any deviations or issues
```

---

### 2. Todo Schema

#### Type Definitions
**Dosya:** `core/src/types/workspace/todo.ts` (YENİ)
```typescript
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'blocked'

export type Task = {
  id: string
  description: string
  checked: boolean
  status: TaskStatus
  startedAt?: number
  completedAt?: number
  duration?: number
  error?: string
  assignedTo?: 'user' | 'ai'
}

export type ConditionalLogic = {
  type: 'if-then' | 'if-then-else' | 'loop' | 'retry'
  condition: string
  thenAction: string
  elseAction?: string
  maxRetries?: number
}

export type Phase = {
  id: string
  number: number
  title: string
  description?: string
  status: TaskStatus
  progress: number  // 0-100
  tasks: Task[]
  instructions?: string  // Markdown/code block
  successCriteria?: Task[]
  onFailure?: string
  conditionalLogic?: ConditionalLogic[]
  dependencies?: string[]  // Phase IDs
  startedAt?: number
  completedAt?: number
  duration?: number
  notes?: string
  metadata?: {
    estimatedDuration?: number
    priority?: 'low' | 'medium' | 'high' | 'critical'
    tags?: string[]
  }
}

export type TodoList = {
  id: string
  projectName: string
  created: number
  updated: number
  status: 'not_started' | 'in_progress' | 'completed' | 'failed'
  currentPhase?: string  // Phase ID
  phases: Phase[]
  overallProgress: {
    totalPhases: number
    completedPhases: number
    currentPhase: number
    percentage: number
  }
  blockers?: Array<{
    phaseId: string
    description: string
    severity: 'low' | 'medium' | 'high'
  }>
  notes?: string
}

export type ExecutionLog = {
  id: string
  todoId: string
  phaseId: string
  taskId?: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
  context?: Record<string, any>
}

export type ExecutionReport = {
  todoId: string
  generatedAt: number
  summary: {
    totalPhases: number
    completedPhases: number
    failedPhases: number
    totalDuration: number
    successRate: number
  }
  phaseDetails: Array<{
    phaseId: string
    title: string
    status: TaskStatus
    duration: number
    tasksCompleted: number
    tasksFailed: number
    issues: string[]
    notes: string
  }>
  performanceMetrics?: Record<string, any>
  lessonsLearned?: string[]
  recommendations?: string[]
}
```

---

### 3. Todo Parser

**Dosya:** `core/src/browser/extensions/workspace/todo-parser.ts` (YENİ)
```typescript
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { TodoList, Phase, Task } from '../../../types/workspace/todo'

export class TodoParser {
  /**
   * Parse todo.md to structured TodoList
   */
  parse(markdownContent: string): TodoList {
    const ast = unified().use(remarkParse).parse(markdownContent)

    // 1. Extract project metadata (name, status, current phase)
    // 2. Parse each phase section (## Phase N: ...)
    // 3. Extract tasks (checkbox lists)
    // 4. Parse instructions (code blocks)
    // 5. Extract success criteria
    // 6. Parse conditional logic
    // 7. Build TodoList object

    return todoList
  }

  /**
   * Convert TodoList back to markdown
   */
  stringify(todoList: TodoList): string {
    // Regenerate markdown from TodoList
    // Preserve formatting and structure
    // Update progress indicators
    // Add timestamps
  }

  /**
   * Validate todo.md syntax
   */
  validate(markdownContent: string): {
    valid: boolean
    errors: Array<{
      line: number
      type: 'error' | 'warning'
      message: string
    }>
    warnings?: string[]
  } {
    // Check phase numbering
    // Validate checkbox syntax
    // Check for circular dependencies
    // Validate conditional logic syntax
  }

  /**
   * Extract conditional logic from instruction blocks
   */
  private parseConditionalLogic(instructionBlock: string): ConditionalLogic[] {
    // Parse IF-THEN-ELSE statements
    // Parse LOOP structures
    // Parse RETRY logic
    // Return structured conditional logic
  }
}
```

---

### 4. Todo Execution Engine

**Dosya:** `extensions/workspace-extension/src/todo-executor.ts` (YENİ)
```typescript
export class TodoExecutor {
  private todoList: TodoList
  private logger: ExecutionLogger
  private rulesEnforcer: RulesEnforcer

  /**
   * Start executing todo list from current phase
   */
  async start(todoId: string): Promise<void> {
    this.todoList = await this.loadTodo(todoId)
    const currentPhase = this.getCurrentPhase()

    await this.executePhase(currentPhase)
  }

  /**
   * Execute a single phase
   */
  private async executePhase(phase: Phase): Promise<void> {
    this.logger.info(`Starting Phase ${phase.number}: ${phase.title}`)
    phase.status = 'in_progress'
    phase.startedAt = Date.now()

    try {
      // 1. Check dependencies
      await this.checkDependencies(phase)

      // 2. Read instructions
      if (phase.instructions) {
        await this.processInstructions(phase.instructions)
      }

      // 3. Execute tasks sequentially
      for (const task of phase.tasks) {
        await this.executeTask(phase, task)
      }

      // 4. Verify success criteria
      const criteriamet = await this.verifySuccessCriteria(phase)

      if (!criteriaMet) {
        throw new Error('Success criteria not met')
      }

      // 5. Mark phase as completed
      phase.status = 'completed'
      phase.completedAt = Date.now()
      phase.duration = phase.completedAt - phase.startedAt!

      this.logger.success(`Phase ${phase.number} completed successfully`)

      // 6. Move to next phase
      await this.moveToNextPhase()

    } catch (error) {
      this.logger.error(`Phase ${phase.number} failed:`, error)
      phase.status = 'failed'
      phase.error = error.message

      // Handle failure
      await this.handlePhaseFailure(phase, error)
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(phase: Phase, task: Task): Promise<void> {
    this.logger.info(`Executing task: ${task.description}`)
    task.status = 'in_progress'
    task.startedAt = Date.now()

    try {
      // Task-specific logic
      if (task.description.includes('Read')) {
        await this.handleReadTask(task)
      } else if (task.description.includes('Write') || task.description.includes('Create')) {
        await this.handleWriteTask(task)
      } else if (task.description.includes('Test')) {
        await this.handleTestTask(task)
      } else {
        // Generic task - delegate to AI
        await this.delegateToAI(phase, task)
      }

      task.status = 'completed'
      task.checked = true
      task.completedAt = Date.now()
      task.duration = task.completedAt - task.startedAt

      // Save progress
      await this.saveTodo()

    } catch (error) {
      task.status = 'failed'
      task.error = error.message
      throw error
    }
  }

  /**
   * Handle read task (e.g., "Read .leah/rules.md lines 122-150")
   */
  private async handleReadTask(task: Task): Promise<void> {
    // Parse task description to extract file path and line numbers
    const match = task.description.match(/Read\s+(.+?)\s+lines?\s+(\d+)-(\d+)/)

    if (match) {
      const [, filePath, startLine, endLine] = match
      const content = await this.workspaceManager.readFile(filePath, {
        startLine: parseInt(startLine),
        endLine: parseInt(endLine)
      })

      // Store in context for AI
      this.context.set('lastReadContent', content)
    }
  }

  /**
   * Process conditional logic
   */
  private async processConditionalLogic(phase: Phase): Promise<void> {
    if (!phase.conditionalLogic) return

    for (const logic of phase.conditionalLogic) {
      const conditionMet = await this.evaluateCondition(logic.condition)

      if (conditionMet) {
        await this.executeAction(logic.thenAction)
      } else if (logic.elseAction) {
        await this.executeAction(logic.elseAction)
      }
    }
  }

  /**
   * Evaluate condition (e.g., "test coverage < 100%")
   */
  private async evaluateCondition(condition: string): Promise<boolean> {
    // Parse condition
    // Extract metrics
    // Evaluate boolean result
    // Return true/false
  }

  /**
   * Handle phase failure
   */
  private async handlePhaseFailure(phase: Phase, error: Error): Promise<void> {
    if (phase.onFailure) {
      this.logger.info('Executing failure handler')
      await this.processInstructions(phase.onFailure)
    }

    // Check for retry logic
    if (phase.conditionalLogic?.some(l => l.type === 'retry')) {
      const retryLogic = phase.conditionalLogic.find(l => l.type === 'retry')!
      await this.retryPhase(phase, retryLogic.maxRetries || 3)
    }
  }

  /**
   * Generate final execution report
   */
  async generateReport(): Promise<ExecutionReport> {
    // Collect stats from all phases
    // Calculate success rate
    // Generate insights
    // Create report object
    // Save to workspace/report_{{DATE}}.md

    return report
  }
}
```

---

### 5. UI Components

#### Todo Dashboard
**Dosya:** `web-app/src/routes/workspace/todo.tsx` (YENİ)
```typescript
export function TodoDashboard() {
  const { todoList, isExecuting } = useTodo()

  return (
    <div className="todo-dashboard">
      {/* Header with overall progress */}
      <TodoHeader todoList={todoList} />

      {/* Phase list with expandable details */}
      <PhaseList phases={todoList.phases} />

      {/* Execution controls */}
      <ExecutionControls
        onStart={startExecution}
        onPause={pauseExecution}
        onResume={resumeExecution}
        isRunning={isExecuting}
      />

      {/* Real-time execution log */}
      <ExecutionLog />
    </div>
  )
}
```

#### Todo Editor
**Dosya:** `web-app/src/components/workspace/TodoEditor.tsx` (YENİ)
```typescript
export function TodoEditor() {
  // Split view: Markdown editor + Structured form
  // Drag-and-drop phase reordering
  // Task templates
  // Syntax validation
  // Auto-save

  return (
    <div className="grid grid-cols-2 gap-4">
      <MarkdownEditor
        value={todoMarkdown}
        onChange={handleChange}
        onValidate={validateSyntax}
      />
      <StructuredView phases={parsedPhases} />
    </div>
  )
}
```

#### Phase Card
**Dosya:** `web-app/src/components/workspace/PhaseCard.tsx` (YENİ)
```typescript
export function PhaseCard({ phase }: { phase: Phase }) {
  return (
    <Card className={cn('phase-card', phase.status)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3>Phase {phase.number}: {phase.title}</h3>
          <PhaseStatusBadge status={phase.status} />
        </div>
        <ProgressBar value={phase.progress} />
      </CardHeader>

      <CardContent>
        {/* Task list */}
        <TaskList tasks={phase.tasks} />

        {/* Success criteria */}
        {phase.successCriteria && (
          <SuccessCriteria criteria={phase.successCriteria} />
        )}

        {/* Instructions */}
        {phase.instructions && (
          <Collapsible>
            <CollapsibleTrigger>View Instructions</CollapsibleTrigger>
            <CollapsibleContent>
              <CodeBlock code={phase.instructions} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>

      <CardFooter>
        {phase.duration && (
          <span>Duration: {formatDuration(phase.duration)}</span>
        )}
      </CardFooter>
    </Card>
  )
}
```

#### Todo Creation Wizard
**Dosya:** `web-app/src/components/workspace/TodoWizard.tsx` (YENİ)
```typescript
export function TodoWizard() {
  // Step 1: Project info (name, description)
  // Step 2: Add phases
  // Step 3: Define tasks for each phase
  // Step 4: Set success criteria
  // Step 5: Add conditional logic (optional)
  // Step 6: Review and generate

  return <MultiStepWizard steps={wizardSteps} />
}
```

#### Execution Log Viewer
**Dosya:** `web-app/src/components/workspace/ExecutionLog.tsx` (YENİ)
```typescript
export function ExecutionLog() {
  const { logs, filter } = useExecutionLogs()

  return (
    <div className="execution-log">
      <div className="log-controls">
        <LogFilter onFilterChange={setFilter} />
        <Button onClick={clearLogs}>Clear</Button>
        <Button onClick={exportLogs}>Export</Button>
      </div>

      <div className="log-entries">
        {logs.map(log => (
          <LogEntry key={log.id} log={log} />
        ))}
      </div>
    </div>
  )
}
```

---

## 📁 Değiştirilecek/Oluşturulacak Dosyalar

### YENİ DOSYALAR

#### Core
1. `core/src/types/workspace/todo.ts` - Todo types
2. `core/src/browser/extensions/workspace/todo-parser.ts` - Todo parser
3. `core/src/browser/extensions/workspace/todo-executor.ts` - Executor interface

#### Extension (workspace-extension'a ekle)
4. `extensions/workspace-extension/src/todo-executor.ts` - Executor implementation
5. `extensions/workspace-extension/src/execution-logger.ts` - Logging
6. `extensions/workspace-extension/src/condition-evaluator.ts` - Conditional logic
7. `extensions/workspace-extension/src/report-generator.ts` - Report generation

#### Web App
8. `web-app/src/routes/workspace/todo.tsx` - Todo dashboard
9. `web-app/src/components/workspace/TodoEditor.tsx` - Todo editor
10. `web-app/src/components/workspace/TodoWizard.tsx` - Creation wizard
11. `web-app/src/components/workspace/PhaseCard.tsx` - Phase display
12. `web-app/src/components/workspace/TaskList.tsx` - Task list component
13. `web-app/src/components/workspace/ExecutionLog.tsx` - Log viewer
14. `web-app/src/components/workspace/ExecutionControls.tsx` - Start/stop controls
15. `web-app/src/hooks/useTodo.ts` - Todo hook
16. `web-app/src/hooks/useExecutionLogs.ts` - Logs hook
17. `web-app/src/services/workspace/todo-service.ts` - Todo service

#### Templates
18. `.leah/templates/todo-simple.template.md` - Simple todo template
19. `.leah/templates/todo-advanced.template.md` - Advanced todo with conditionals
20. `.leah/templates/todo-development.template.md` - Software development template

### GÜNCELLENECEKETİ DOSYALAR
1. `extensions/workspace-extension/src/index.ts` - Todo methods ekle
2. `web-app/src/routes/workspace/index.tsx` - Todo dashboard link
3. `core/src/types/workspace/config.ts` - Todo config ekle

---

## 🔄 İş Akışı

### 1. Todo Creation
```
User → Workspace → Create Todo
→ Use wizard or write markdown
→ Define phases and tasks
→ Set success criteria
→ Add conditional logic (optional)
→ Validate syntax
→ Save to .leah/todo.md
```

### 2. Execution Flow
```
User → Start Execution
→ TodoExecutor loads todo.md
→ Parse to TodoList object
→ Start from current phase
→ For each task in phase:
  → Execute task
  → Log result
  → Update progress
  → Check success criteria
→ If phase complete:
  → Move to next phase
→ If phase fails:
  → Run onFailure handler
  → Retry if configured
→ Repeat until all phases done
→ Generate final report
```

### 3. Error Handling
```
Task fails
→ Log error details
→ Check for retry logic
→ If retry available:
  → Wait specified time
  → Retry task
  → Max retries reached → fail phase
→ If onFailure defined:
  → Execute failure handler
→ If critical error:
  → Pause execution
  → Notify user
  → Wait for manual intervention
```

### 4. Conditional Logic Example
```markdown
IF test coverage < 100%:
  - Run: yarn test --coverage
  - Identify untested files
  - Write missing tests
  - Re-run coverage check
  - GOTO start of Phase
ELSE:
  - Proceed to next phase
END IF
```

---

## ⚡ Performans Optimizasyonları

### 1. Parsing
- Parse todo.md once on load
- Incremental updates on save
- Cache parsed structure

### 2. Execution
- Parallel task execution where possible
- Stream logs in real-time
- Throttle UI updates (max 10/sec)

### 3. State Management
- Use Zustand for global state
- Optimistic UI updates
- Persist state to IndexedDB

### 4. Memory
- Clean old logs (> 7 days)
- Limit in-memory log entries (max 1000)
- Paginate phase history

---

## 🧪 Test Planı

### Unit Tests
- [ ] Todo parser accuracy
- [ ] Conditional logic evaluation
- [ ] Task execution logic
- [ ] Error handling

### Integration Tests
- [ ] End-to-end todo execution
- [ ] Phase dependency resolution
- [ ] Retry mechanism
- [ ] Report generation

### E2E Tests
- [ ] Create todo via wizard
- [ ] Execute multi-phase todo
- [ ] Handle execution failure
- [ ] Generate and view report

---

## 📊 Başarı Kriterleri

1. ✅ Kullanıcı 10 dakikada todo oluşturabilmeli
2. ✅ Todo parsing < 200ms
3. ✅ Task execution latency < 1s
4. ✅ Real-time log updates < 100ms delay
5. ✅ Conditional logic %95+ doğruluk
6. ✅ Report generation < 2s

---

## 🚀 Implementation Sırası

1. **Gün 1-2:** Type definitions ve todo schema
2. **Gün 3-4:** Todo parser implementasyonu
3. **Gün 5-6:** Execution engine core logic
4. **Gün 7-8:** Conditional logic ve error handling
5. **Gün 9-10:** Task executors (read, write, test, etc.)
6. **Gün 11-12:** UI components (dashboard, editor)
7. **Gün 13-14:** Execution controls ve log viewer
8. **Gün 15-16:** Report generation
9. **Gün 17-18:** Templates ve wizard
10. **Gün 19-20:** Testing ve optimization
11. **Gün 21:** Bug fixes ve polish

---

## 🔗 Dependencies

### NPM Packages (Yeni)
```json
{
  "dependencies": {
    "cron-parser": "^4.9.0",       // Scheduling (future feature)
    "expression-eval": "^5.1.0",   // Condition evaluation
    "markdown-it": "^14.0.0",      // Markdown rendering
    "react-flow-renderer": "^10.3.17"  // Visual todo flow (optional)
  }
}
```

---

## 📝 Example Templates

### Simple Todo
```markdown
# Simple Todo

## Phase 1: Setup
- [ ] Install dependencies
- [ ] Configure environment
- [ ] Run tests

## Phase 2: Development
- [ ] Implement feature X
- [ ] Write tests
- [ ] Update docs
```

### Advanced Todo with Conditionals
```markdown
# Advanced Todo

## Phase 1: Build
**Instructions:**
```
1. Run: yarn build
2. IF build fails:
   - Check error logs
   - Fix compilation errors
   - RETRY build (max 3 times)
3. ELSE:
   - Proceed to Phase 2
```

**Success Criteria:**
- [ ] Build completes without errors
- [ ] Bundle size < 5MB
```

---

## ⚠️ Dikkat Edilecekler

1. **Atomicity:** Her task atomic olmalı, yarım kalan task durumu handle edilmeli
2. **Idempotency:** Aynı task birden çalıştırılabilmeli (retry için)
3. **Logging:** Her action detaylı loglanmalı (debugging için)
4. **State Persistence:** Execution state her adımda kaydedilmeli (crash recovery)
5. **User Control:** Kullanıcı istediği zaman pause/resume/stop edebilmeli
6. **Rules Integration:** Todo execution sırasında rules.md kuralları uygulanmalı

---

## 🎯 Next Phase Preview

**Phase 4: Multi-Model Chat ve Karşılaştırma**
- 2-3 model paralel chat
- Side-by-side interface
- Response comparison
- Model benchmarking
