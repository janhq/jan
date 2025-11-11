# PHASE 8: Agent Sistemi (Dual-Model Architecture)

## 🎯 Amaç
İki modelin birlikte çalışarak otonom görev yönetimi yapması: Bir model (Supervisor) kuralları denetler ve plan yapar, diğer model (Worker) işleri uygular.

## 📋 Özellikler
1. ✅ Dual-Model Architecture (Supervisor + Worker)
2. ✅ Autonomous Task Execution
3. ✅ Rules Enforcement (Supervisor)
4. ✅ Phase-based Auto-Execution
5. ✅ Real-time Progress Monitoring
6. ✅ Error Detection & Recovery
7. ✅ Final Report Generation

---

## 🏗️ Mimari Yapı

### 1. Agent System Types

**Dosya:** `core/src/types/agent/agent.ts` (YENİ)
```typescript
export type AgentRole = 'supervisor' | 'worker'

export type AgentConfig = {
  id: string
  role: AgentRole
  model: ModelInfo
  provider: string
  enabled: boolean
  settings: {
    temperature?: number
    maxRetries?: number
    timeoutSeconds?: number
  }
}

export type AgentSession = {
  id: string
  name: string
  todoId: string  // Reference to .leah/todo.md
  supervisor: AgentConfig
  worker: AgentConfig
  status: 'initializing' | 'running' | 'paused' | 'completed' | 'failed'
  currentPhase?: string
  currentTask?: string
  startedAt: number
  completedAt?: number
  progress: {
    totalPhases: number
    completedPhases: number
    currentPhaseProgress: number
  }
  logs: AgentLog[]
  metrics: {
    totalDuration: number
    supervisorCalls: number
    workerCalls: number
    totalCost: number
    errorsEncountered: number
    retriesPerformed: number
  }
}

export type AgentLog = {
  id: string
  sessionId: string
  timestamp: number
  agent: AgentRole
  level: 'debug' | 'info' | 'warn' | 'error' | 'success'
  phase?: string
  task?: string
  message: string
  context?: Record<string, any>
}

export type AgentCommunication = {
  from: AgentRole
  to: AgentRole
  type: 'instruction' | 'result' | 'error' | 'question'
  content: string
  metadata?: Record<string, any>
  timestamp: number
}
```

---

### 2. Agent System Flow

```
┌─────────────────────────────────────────────────────┐
│                   SUPERVISOR MODEL                   │
│  (Ollama: Qwen3-VL:30B or similar)                  │
│                                                      │
│  Responsibilities:                                   │
│  1. Read .leah/todo.md and .leah/rules.md          │
│  2. Plan task execution strategy                    │
│  3. Monitor worker's output                         │
│  4. Validate against rules                          │
│  5. Detect errors and request fixes                 │
│  6. Decide to proceed or retry                      │
│  7. Generate final report                           │
└──────────────────┬──────────────────────────────────┘
                   │ Instructions
                   │ (with rules context)
                   ▼
┌─────────────────────────────────────────────────────┐
│                    WORKER MODEL                      │
│  (LM Studio: Qwen3-Coder:30B or similar)            │
│                                                      │
│  Responsibilities:                                   │
│  1. Receive tasks from supervisor                   │
│  2. Execute tasks (code, write, test, etc.)        │
│  3. Return results to supervisor                    │
│  4. Follow supervisor's corrections                 │
│  5. Report blockers/issues                          │
└─────────────────────────────────────────────────────┘
```

---

### 3. Agent Orchestrator

**Dosya:** `extensions/agent-extension/src/orchestrator.ts` (YENİ)
```typescript
export class AgentOrchestrator {
  private session: AgentSession
  private supervisor: AgentClient
  private worker: AgentClient
  private rulesEnforcer: RulesEnforcer
  private todoExecutor: TodoExecutor

  /**
   * Initialize agent session
   */
  async initialize(config: {
    supervisorModel: ModelInfo
    workerModel: ModelInfo
    todoId: string
  }): Promise<AgentSession> {
    // 1. Load todo.md
    const todo = await this.loadTodo(config.todoId)

    // 2. Load rules.md
    const rules = await this.loadRules()

    // 3. Initialize supervisor
    this.supervisor = new AgentClient(config.supervisorModel, 'supervisor')

    // 4. Initialize worker
    this.worker = new AgentClient(config.workerModel, 'worker')

    // 5. Create session
    this.session = this.createSession(todo, rules)

    return this.session
  }

  /**
   * Start autonomous execution
   */
  async start(): Promise<void> {
    this.log('info', 'Starting agent session')

    // Load context for supervisor
    const context = await this.prepareContext()

    // Supervisor reads todo and creates plan
    const plan = await this.supervisor.send({
      role: 'supervisor',
      prompt: this.buildSupervisorPrompt(context)
    })

    this.log('info', 'Execution plan created', { plan })

    // Execute phases
    for (const phase of this.session.todo.phases) {
      await this.executePhase(phase)
    }

    // Generate final report
    await this.generateFinalReport()
  }

  /**
   * Execute a single phase
   */
  private async executePhase(phase: Phase): Promise<void> {
    this.log('info', `Starting Phase ${phase.number}: ${phase.title}`)

    // Supervisor analyzes phase
    const phaseInstructions = await this.supervisor.send({
      role: 'supervisor',
      prompt: `
You are the supervisor. Analyze this phase and break it into actionable tasks for the worker:

Phase: ${phase.title}
Tasks:
${phase.tasks.map(t => `- ${t.description}`).join('\n')}

Instructions:
${phase.instructions || 'None'}

Rules to enforce:
${this.formatRules()}

Provide clear, step-by-step instructions for the worker.
      `
    })

    // Execute tasks
    for (const task of phase.tasks) {
      await this.executeTask(phase, task, phaseInstructions)
    }

    // Supervisor verifies success criteria
    const criteriaCheck = await this.checkSuccessCriteria(phase)

    if (!criteriaCheck.passed) {
      this.log('warn', 'Success criteria not met', criteriaCheck)
      await this.handlePhaseFailure(phase, criteriaCheck)
    } else {
      this.log('success', `Phase ${phase.number} completed successfully`)
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(
    phase: Phase,
    task: Task,
    instructions: string
  ): Promise<void> {
    this.log('info', `Executing task: ${task.description}`)

    let attempt = 0
    const maxRetries = 3
    let success = false

    while (attempt < maxRetries && !success) {
      try {
        // Worker executes task
        const result = await this.worker.send({
          role: 'worker',
          prompt: `
You are the worker AI. Execute this task:

Task: ${task.description}
Instructions from supervisor: ${instructions}

Context:
${this.getTaskContext(task)}

Execute the task and report your results clearly.
          `
        })

        this.log('info', 'Worker result received', { result })

        // Supervisor validates result
        const validation = await this.supervisorValidate(task, result)

        if (validation.valid) {
          task.status = 'completed'
          task.checked = true
          success = true
          this.log('success', `Task completed: ${task.description}`)
        } else {
          this.log('warn', 'Validation failed', validation)

          // Supervisor provides feedback
          const feedback = await this.supervisor.send({
            role: 'supervisor',
            prompt: `
The worker's result for task "${task.description}" has issues:

Issues: ${validation.issues.join(', ')}

Rules violated: ${validation.ruleViolations.join(', ')}

Provide specific instructions to fix these issues.
            `
          })

          // Retry with feedback
          attempt++
          if (attempt < maxRetries) {
            this.log('info', `Retrying task (attempt ${attempt + 1}/${maxRetries})`)
            instructions = feedback
          }
        }
      } catch (error) {
        this.log('error', 'Task execution failed', { error })
        attempt++
      }
    }

    if (!success) {
      throw new Error(`Task failed after ${maxRetries} attempts: ${task.description}`)
    }
  }

  /**
   * Supervisor validates worker's result
   */
  private async supervisorValidate(
    task: Task,
    result: string
  ): Promise<{
    valid: boolean
    issues: string[]
    ruleViolations: string[]
  }> {
    // Check against rules
    const ruleCheck = await this.rulesEnforcer.checkViolations({
      type: 'code',
      content: result
    })

    // Supervisor evaluates quality
    const validation = await this.supervisor.send({
      role: 'supervisor',
      prompt: `
Validate the worker's result for task: ${task.description}

Result:
${result}

Check for:
1. Correctness
2. Completeness
3. Rule compliance
4. Quality

Respond with JSON:
{
  "valid": true/false,
  "issues": ["issue1", "issue2"],
  "ruleViolations": ["violation1"]
}
      `
    })

    return JSON.parse(validation)
  }

  /**
   * Generate final execution report
   */
  private async generateFinalReport(): Promise<void> {
    const report = await this.supervisor.send({
      role: 'supervisor',
      prompt: `
Generate a comprehensive final report for this project execution.

Session Summary:
- Total Phases: ${this.session.progress.totalPhases}
- Completed: ${this.session.progress.completedPhases}
- Duration: ${this.session.metrics.totalDuration}ms
- Cost: $${this.session.metrics.totalCost}
- Errors: ${this.session.metrics.errorsEncountered}
- Retries: ${this.session.metrics.retriesPerformed}

Include:
1. Executive summary
2. Phase-by-phase breakdown
3. Issues encountered and resolutions
4. Performance metrics
5. Lessons learned
6. Recommendations

Format in Markdown.
      `
    })

    // Save report
    const timestamp = new Date().toISOString().split('T')[0]
    await this.workspaceManager.writeFile(
      `workspace/report_${timestamp}.md`,
      report
    )

    this.log('success', 'Final report generated')
  }
}
```

---

### 4. UI Components

#### Agent Dashboard
**Dosya:** `web-app/src/routes/agent/dashboard.tsx` (YENİ)
```typescript
export function AgentDashboard() {
  return (
    <div className="agent-dashboard">
      {/* Session Info */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Session</CardTitle>
          <Badge status={session.status}>{session.status}</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Supervisor</Label>
              <ModelBadge model={session.supervisor.model} />
            </div>
            <div>
              <Label>Worker</Label>
              <ModelBadge model={session.worker.model} />
            </div>
          </div>

          {/* Progress */}
          <div className="mt-4">
            <Label>Overall Progress</Label>
            <Progress value={overallProgress} />
            <span>
              Phase {session.progress.completedPhases + 1} of {session.progress.totalPhases}
            </span>
          </div>

          {/* Controls */}
          <div className="mt-4 space-x-2">
            {session.status === 'running' ? (
              <Button onClick={pause}>Pause</Button>
            ) : (
              <Button onClick={resume}>Resume</Button>
            )}
            <Button variant="destructive" onClick={stop}>Stop</Button>
          </div>
        </CardContent>
      </Card>

      {/* Live Agent Communication */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Agent Communication</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentCommunicationLog communications={communications} />
        </CardContent>
      </Card>

      {/* Real-time Logs */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Execution Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <LogViewer logs={session.logs} autoScroll />
        </CardContent>
      </Card>
    </div>
  )
}
```

#### Agent Setup Wizard
**Dosya:** `web-app/src/components/agent/AgentSetupWizard.tsx` (YENİ)
```typescript
export function AgentSetupWizard() {
  return (
    <Dialog>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Setup Agent Session</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="models">
          <TabsList>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="todo">Todo</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="models">
            <div className="space-y-4">
              <div>
                <Label>Supervisor Model</Label>
                <ModelSelector
                  value={supervisorModel}
                  onChange={setSupervisorModel}
                  filter={m => m.capabilities.reasoning}
                />
              </div>

              <div>
                <Label>Worker Model</Label>
                <ModelSelector
                  value={workerModel}
                  onChange={setWorkerModel}
                  filter={m => m.capabilities.coding}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="todo">
            <div>
              <Label>Select Todo List</Label>
              <Select value={todoId} onChange={setTodoId}>
                {todos.map(todo => (
                  <option key={todo.id} value={todo.id}>
                    {todo.projectName}
                  </option>
                ))}
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="settings">
            <div className="space-y-3">
              <div>
                <Label>Max Retries per Task</Label>
                <Input type="number" value={maxRetries} onChange={e => setMaxRetries(e.target.value)} />
              </div>
              <div>
                <Label>Task Timeout (seconds)</Label>
                <Input type="number" value={timeout} onChange={e => setTimeout(e.target.value)} />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button onClick={startSession}>Start Agent Session</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

---

## 📁 Yeni Dosyalar

### Core
1. `core/src/types/agent/agent.ts`
2. `core/src/browser/extensions/agent.ts`

### Extension
3. `extensions/agent-extension/` (yeni)
   - `src/orchestrator.ts`
   - `src/agent-client.ts`
   - `src/communication-manager.ts`

### Web App
4. `web-app/src/routes/agent/dashboard.tsx`
5. `web-app/src/routes/agent/setup.tsx`
6. `web-app/src/components/agent/AgentSetupWizard.tsx`
7. `web-app/src/components/agent/AgentCommunicationLog.tsx`
8. `web-app/src/hooks/useAgentSession.ts`

---

## 🚀 Implementation: 14-16 gün

---

## 📊 Başarı Kriterleri

1. ✅ Supervisor-Worker communication latency < 500ms
2. ✅ Rules compliance > 95%
3. ✅ Auto-recovery success rate > 80%
4. ✅ Phase completion without manual intervention > 70%
5. ✅ Final report generated successfully every time

---

## 🎯 Next Phase: Phase 9 - Import/Export & Batch Operations
