# PHASE 9: Import/Export & Batch Operations

## 🎯 Amaç
Konuşmaların, ayarların, kuralların ve şablonların import/export edilebilmesi, batch processing ve veri taşıma işlemlerinin kolaylaştırılması.

## 📋 Özellikler
1. ✅ Conversation Export/Import (JSON, MD, TXT, HTML)
2. ✅ Settings Export/Import
3. ✅ Rules & Templates Export/Import
4. ✅ Batch Processing (Multiple prompts)
5. ✅ Data Migration Tools
6. ✅ Backup & Restore
7. ✅ Selective Export

---

## 🏗️ Mimari Yapı

### 1. Export/Import Types

**Dosya:** `core/src/types/export/export.ts` (YENİ)
```typescript
export type ExportFormat = 'json' | 'markdown' | 'txt' | 'html' | 'csv'

export type ExportOptions = {
  format: ExportFormat
  includeMetadata: boolean
  includeTimestamps: boolean
  includeTokenStats: boolean
  prettify: boolean
  filterMessages?: (message: Message) => boolean
}

export type ConversationExport = {
  version: string
  exportedAt: number
  thread: {
    id: string
    title: string
    created: number
    updated: number
  }
  messages: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: number
    model?: string
    tokens?: {
      input: number
      output: number
    }
    metadata?: Record<string, any>
  }>
  metadata: {
    totalMessages: number
    totalTokens: number
    totalCost: number
    models: string[]
  }
}

export type SettingsExport = {
  version: string
  exportedAt: number
  workspace: WorkspaceConfig
  rules: RuleSet
  templates: PromptTemplate[]
  apiProviders: APIProvider[]
  preferences: Record<string, any>
}

export type BatchRequest = {
  id: string
  prompts: Array<{
    id: string
    prompt: string
    model: string
    parameters?: Record<string, any>
  }>
  status: 'pending' | 'processing' | 'completed' | 'failed'
  results?: Array<{
    promptId: string
    response: string
    tokens: number
    duration: number
    cost: number
    error?: string
  }>
  createdAt: number
  completedAt?: number
}
```

---

### 2. Export/Import Extension

**Dosya:** `core/src/browser/extensions/export-import.ts` (YENİ)
```typescript
export abstract class ExportImportExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.ExportImport
  }

  // Conversation Export/Import
  abstract exportConversation(
    threadId: string,
    options: ExportOptions
  ): Promise<Blob>

  abstract exportMultipleConversations(
    threadIds: string[],
    options: ExportOptions
  ): Promise<Blob>  // ZIP file

  abstract importConversation(file: File): Promise<Thread>

  // Settings Export/Import
  abstract exportSettings(): Promise<Blob>
  abstract importSettings(file: File): Promise<void>

  // Full Backup
  abstract createBackup(options: {
    includeConversations: boolean
    includeSettings: boolean
    includeDocuments: boolean
    includeVectorDB: boolean
  }): Promise<Blob>

  abstract restoreBackup(file: File): Promise<{
    conversationsRestored: number
    settingsRestored: boolean
    documentsRestored: number
  }>

  // Batch Processing
  abstract createBatchRequest(request: BatchRequest): Promise<string>
  abstract executeBatchRequest(requestId: string): Promise<BatchRequest>
  abstract getBatchStatus(requestId: string): Promise<BatchRequest>
  abstract cancelBatchRequest(requestId: string): Promise<void>
}
```

---

### 3. Export Formatters

#### JSON Exporter
```typescript
// json-exporter.ts
export class JSONExporter {
  export(thread: Thread, messages: Message[], options: ExportOptions): string {
    const exportData: ConversationExport = {
      version: '1.0',
      exportedAt: Date.now(),
      thread: {
        id: thread.id,
        title: thread.title,
        created: thread.created,
        updated: thread.updated
      },
      messages: messages.map(m => this.formatMessage(m, options)),
      metadata: this.generateMetadata(messages)
    }

    return options.prettify
      ? JSON.stringify(exportData, null, 2)
      : JSON.stringify(exportData)
  }
}
```

#### Markdown Exporter
```typescript
// markdown-exporter.ts
export class MarkdownExporter {
  export(thread: Thread, messages: Message[], options: ExportOptions): string {
    let md = `# ${thread.title}\n\n`

    if (options.includeMetadata) {
      md += `**Created:** ${new Date(thread.created).toLocaleString()}\n`
      md += `**Updated:** ${new Date(thread.updated).toLocaleString()}\n\n`
    }

    md += `---\n\n`

    for (const message of messages) {
      md += this.formatMessage(message, options)
      md += `\n\n---\n\n`
    }

    if (options.includeTokenStats) {
      md += this.formatStats(messages)
    }

    return md
  }

  private formatMessage(message: Message, options: ExportOptions): string {
    let md = `## ${message.role === 'user' ? '👤 User' : '🤖 Assistant'}\n\n`

    if (options.includeTimestamps) {
      md += `*${new Date(message.timestamp).toLocaleString()}*\n\n`
    }

    md += message.content

    if (options.includeMetadata && message.model) {
      md += `\n\n*Model: ${message.model}*`
    }

    return md
  }
}
```

#### HTML Exporter
```typescript
// html-exporter.ts
export class HTMLExporter {
  export(thread: Thread, messages: Message[], options: ExportOptions): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${thread.title}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .message { margin: 20px 0; padding: 15px; border-radius: 8px; }
    .user { background: #e3f2fd; }
    .assistant { background: #f5f5f5; }
    .metadata { color: #666; font-size: 0.9em; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
    pre { background: #f5f5f5; padding: 15px; border-radius: 8px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>${thread.title}</h1>
  ${messages.map(m => this.formatMessageHTML(m, options)).join('\n')}
</body>
</html>
    `
  }
}
```

---

### 4. Batch Processor

**Dosya:** `extensions/export-import-extension/src/batch-processor.ts` (YENİ)
```typescript
export class BatchProcessor {
  async processBatch(request: BatchRequest): Promise<BatchRequest> {
    request.status = 'processing'
    request.results = []

    for (const prompt of request.prompts) {
      try {
        const startTime = Date.now()

        // Execute prompt
        const response = await this.inference({
          model: prompt.model,
          messages: [{ role: 'user', content: prompt.prompt }],
          parameters: prompt.parameters
        })

        const duration = Date.now() - startTime

        // Record result
        request.results.push({
          promptId: prompt.id,
          response: response.content,
          tokens: response.tokens.total,
          duration,
          cost: this.calculateCost(response)
        })

      } catch (error) {
        request.results.push({
          promptId: prompt.id,
          response: '',
          tokens: 0,
          duration: 0,
          cost: 0,
          error: error.message
        })
      }
    }

    request.status = 'completed'
    request.completedAt = Date.now()

    return request
  }
}
```

---

### 5. UI Components

#### Export Dialog
**Dosya:** `web-app/src/components/export/ExportDialog.tsx` (YENİ)
```typescript
export function ExportDialog({ threadId }: { threadId: string }) {
  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Conversation</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Format Selection */}
          <div>
            <Label>Format</Label>
            <RadioGroup value={format} onChange={setFormat}>
              <Radio value="json">JSON</Radio>
              <Radio value="markdown">Markdown</Radio>
              <Radio value="html">HTML</Radio>
              <Radio value="txt">Plain Text</Radio>
            </RadioGroup>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <Checkbox checked={includeMetadata} onChange={setIncludeMetadata}>
              Include metadata
            </Checkbox>
            <Checkbox checked={includeTimestamps} onChange={setIncludeTimestamps}>
              Include timestamps
            </Checkbox>
            <Checkbox checked={includeTokenStats} onChange={setIncludeTokenStats}>
              Include token statistics
            </Checkbox>
          </div>

          {/* Preview */}
          <div>
            <Label>Preview</Label>
            <div className="bg-muted p-3 rounded max-h-40 overflow-auto">
              <pre>{exportPreview}</pre>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={download}>Download</Button>
          <Button onClick={copyToClipboard}>Copy to Clipboard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

#### Batch Processing UI
**Dosya:** `web-app/src/routes/batch/index.tsx` (YENİ)
```typescript
export function BatchProcessing() {
  return (
    <div className="batch-processing">
      <Card>
        <CardHeader>
          <CardTitle>Batch Processing</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Prompt Input */}
          <Textarea
            label="Prompts (one per line)"
            value={prompts}
            onChange={e => setPrompts(e.target.value)}
            rows={10}
            placeholder="Enter multiple prompts, one per line..."
          />

          {/* Model Selection */}
          <Select label="Model" value={model} onChange={setModel}>
            {models.map(m => <option key={m.id}>{m.name}</option>)}
          </Select>

          {/* Parameters */}
          <Collapsible>
            <CollapsibleTrigger>Advanced Parameters</CollapsibleTrigger>
            <CollapsibleContent>
              <ParametersForm parameters={parameters} onChange={setParameters} />
            </CollapsibleContent>
          </Collapsible>

          <Button onClick={startBatch} disabled={isProcessing}>
            {isProcessing ? 'Processing...' : 'Start Batch'}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {batchResult && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <Button onClick={exportResults}>Export Results</Button>
          </CardHeader>
          <CardContent>
            <BatchResultsTable results={batchResult.results} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

#### Backup & Restore
**Dosya:** `web-app/src/routes/settings/backup.tsx` (YENİ)
```typescript
export function BackupAndRestore() {
  return (
    <div className="backup-restore">
      {/* Create Backup */}
      <Card>
        <CardHeader>
          <CardTitle>Create Backup</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Checkbox checked={includeConversations} onChange={setIncludeConversations}>
              Include conversations ({conversationCount})
            </Checkbox>
            <Checkbox checked={includeSettings} onChange={setIncludeSettings}>
              Include settings
            </Checkbox>
            <Checkbox checked={includeDocuments} onChange={setIncludeDocuments}>
              Include documents ({documentCount})
            </Checkbox>
            <Checkbox checked={includeVectorDB} onChange={setIncludeVectorDB}>
              Include vector database
            </Checkbox>
          </div>

          <Button onClick={createBackup} disabled={isCreating}>
            {isCreating ? 'Creating...' : 'Create Backup'}
          </Button>
        </CardContent>
      </Card>

      {/* Restore */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Restore Backup</CardTitle>
        </CardHeader>
        <CardContent>
          <DropZone
            accept=".zip"
            onDrop={handleRestore}
          />

          {restoreProgress && (
            <div className="mt-4">
              <Progress value={restoreProgress.percentage} />
              <span>{restoreProgress.message}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

---

## 📁 Yeni Dosyalar

### Core
1. `core/src/types/export/export.ts`
2. `core/src/browser/extensions/export-import.ts`

### Extension
3. `extensions/export-import-extension/` (yeni)
   - `src/exporters/json-exporter.ts`
   - `src/exporters/markdown-exporter.ts`
   - `src/exporters/html-exporter.ts`
   - `src/batch-processor.ts`
   - `src/backup-manager.ts`

### Web App
4. `web-app/src/routes/batch/index.tsx`
5. `web-app/src/routes/settings/backup.tsx`
6. `web-app/src/components/export/ExportDialog.tsx`
7. `web-app/src/components/export/ImportDialog.tsx`
8. `web-app/src/components/batch/BatchResultsTable.tsx`
9. `web-app/src/hooks/useExport.ts`
10. `web-app/src/hooks/useBatch.ts`

---

## 🔗 Dependencies

```json
{
  "dependencies": {
    "jszip": "^3.10.1",        // ZIP creation
    "file-saver": "^2.0.5"     // File download
  }
}
```

---

## 🚀 Implementation: 8-10 gün

---

## 📊 Başarı Kriterleri

1. ✅ Export < 2s for 100 messages
2. ✅ Import success rate > 99%
3. ✅ Batch processing 10 prompts < 30s
4. ✅ Backup creation < 5s (excluding documents)
5. ✅ Restore without data loss

---

## 🎯 Next Phase: Phase 10 - Gelişmiş UI/UX
