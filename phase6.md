# PHASE 6: Prompt Templates Library

## 🎯 Amaç
Kullanıcılara profesyonel, test edilmiş prompt şablonları sunmak ve kendi şablonlarını oluşturmalarını sağlamak.

## 📋 Özellikler
1. ✅ Prompt Template Yapısı
2. ✅ Professional Template Collection (100+ templates)
3. ✅ Template Categories (Coding, Writing, Analysis, etc.)
4. ✅ Template Variables/Placeholders
5. ✅ Template Editor & Preview
6. ✅ Import/Export Templates
7. ✅ Community Templates (Optional)

---

## 🏗️ Mimari Yapı

### 1. Template Type

**Dosya:** `core/src/types/prompts/template.ts` (YENİ)
```typescript
export type PromptTemplate = {
  id: string
  name: string
  description: string
  category: TemplateCategory
  prompt: string
  variables: TemplateVariable[]
  tags: string[]
  author?: string
  version: string
  rating?: number
  usageCount?: number
  createdAt: number
  updatedAt: number
  metadata: {
    language?: string
    difficulty?: 'beginner' | 'intermediate' | 'advanced'
    estimatedTokens?: number
    modelRecommendations?: string[]
  }
}

export type TemplateCategory =
  | 'coding'
  | 'writing'
  | 'analysis'
  | 'translation'
  | 'education'
  | 'business'
  | 'creative'
  | 'research'
  | 'debugging'
  | 'refactoring'
  | 'documentation'
  | 'testing'
  | 'other'

export type TemplateVariable = {
  name: string
  type: 'text' | 'textarea' | 'select' | 'number' | 'boolean'
  label: string
  description?: string
  required: boolean
  default?: any
  options?: Array<{ value: string, label: string }>  // for select
  validation?: {
    min?: number
    max?: number
    pattern?: string
  }
}
```

---

### 2. Template Examples

#### Coding Templates
```markdown
# Template: Code Review
**Category:** Coding
**Variables:**
- {CODE} (textarea, required): Code to review
- {LANGUAGE} (select): Programming language
- {FOCUS} (select): Review focus (performance, security, style, all)

**Prompt:**
```
You are an expert code reviewer. Review the following {LANGUAGE} code:

\`\`\`{LANGUAGE}
{CODE}
\`\`\`

Focus on: {FOCUS}

Provide:
1. Issues found (with severity: critical, high, medium, low)
2. Specific suggestions for improvement
3. Best practices recommendations
4. Refactored code examples where applicable

Format your review in sections.
```
```

#### Writing Templates
```markdown
# Template: Blog Post Writer
**Category:** Writing
**Variables:**
- {TOPIC} (text, required): Blog post topic
- {TONE} (select): Tone (professional, casual, friendly, technical)
- {LENGTH} (select): Length (short: 500w, medium: 1000w, long: 2000w)
- {AUDIENCE} (text): Target audience

**Prompt:**
```
Write a {TONE} blog post about "{TOPIC}" for {AUDIENCE}.

Requirements:
- Length: {LENGTH} words
- Include an engaging introduction
- Use headers and subheaders
- Add a conclusion with call-to-action
- Write in {TONE} tone
- Make it SEO-friendly

Structure:
1. Catchy title
2. Introduction (hook + overview)
3. Main content (3-5 sections with headers)
4. Conclusion
```
```

#### Analysis Templates
```markdown
# Template: Data Analysis
**Category:** Analysis
**Variables:**
- {DATA} (textarea, required): Data to analyze
- {ANALYSIS_TYPE} (select): Type (statistical, trend, comparative, predictive)
- {FORMAT} (select): Output format (report, summary, visualization)

**Prompt:**
```
Perform a {ANALYSIS_TYPE} analysis on the following data:

{DATA}

Provide:
1. Key insights and patterns
2. Statistical summary
3. Anomalies or outliers
4. Trends and correlations
5. Actionable recommendations

Format output as: {FORMAT}
```
```

---

### 3. Template Manager Extension

**Dosya:** `core/src/browser/extensions/template-manager.ts` (YENİ)
```typescript
export abstract class TemplateManagerExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.TemplateManager
  }

  // CRUD
  abstract createTemplate(template: PromptTemplate): Promise<void>
  abstract updateTemplate(id: string, updates: Partial<PromptTemplate>): Promise<void>
  abstract deleteTemplate(id: string): Promise<void>
  abstract getTemplate(id: string): Promise<PromptTemplate>
  abstract listTemplates(filters?: TemplateFilters): Promise<PromptTemplate[]>

  // Categories
  abstract getCategories(): Promise<TemplateCategory[]>
  abstract getTemplatesByCategory(category: TemplateCategory): Promise<PromptTemplate[]>

  // Search
  abstract searchTemplates(query: string): Promise<PromptTemplate[]>

  // Rendering
  abstract renderTemplate(templateId: string, variables: Record<string, any>): Promise<string>

  // Import/Export
  abstract exportTemplate(templateId: string): Promise<Blob>
  abstract importTemplate(file: File): Promise<PromptTemplate>
  abstract exportAll(): Promise<Blob>
  abstract importBulk(file: File): Promise<number>
}
```

---

### 4. UI Components

#### Template Library Browser
**Dosya:** `web-app/src/routes/prompts/library.tsx` (YENİ)
```typescript
export function TemplateLibrary() {
  return (
    <div className="template-library">
      {/* Search & Filter */}
      <div className="controls">
        <Input
          placeholder="Search templates..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <Select value={category} onChange={setCategory}>
          <option value="all">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </Select>

        <Button onClick={openEditor}>Create New</Button>
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map(template => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>
    </div>
  )
}
```

#### Template Editor
**Dosya:** `web-app/src/components/prompts/TemplateEditor.tsx` (YENİ)
```typescript
export function TemplateEditor({ template }: { template?: PromptTemplate }) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {template ? 'Edit Template' : 'Create Template'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          {/* Left: Form */}
          <div className="space-y-4">
            <Input label="Name" {...register('name')} />
            <Textarea label="Description" {...register('description')} />
            <Select label="Category" {...register('category')}>
              {categories.map(cat => <option key={cat}>{cat}</option>)}
            </Select>

            <div>
              <Label>Variables</Label>
              <VariableList variables={variables} onChange={setVariables} />
              <Button onClick={addVariable}>Add Variable</Button>
            </div>

            <Textarea
              label="Prompt Template"
              {...register('prompt')}
              rows={10}
              placeholder="Write your prompt with {VARIABLES}"
            />
          </div>

          {/* Right: Preview */}
          <div className="preview-panel">
            <Label>Preview</Label>
            <TemplatePreview
              template={watchTemplate}
              sampleData={sampleData}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSave}>Save Template</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

#### Template Usage Dialog
**Dosya:** `web-app/src/components/prompts/TemplateUseDialog.tsx` (YENİ)
```typescript
export function TemplateUseDialog({ template }: { template: PromptTemplate }) {
  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>

        {/* Variable Inputs */}
        <div className="space-y-3">
          {template.variables.map(variable => (
            <VariableInput
              key={variable.name}
              variable={variable}
              value={values[variable.name]}
              onChange={value => setValues({ ...values, [variable.name]: value })}
            />
          ))}
        </div>

        {/* Preview rendered prompt */}
        <div className="preview">
          <Label>Generated Prompt:</Label>
          <div className="bg-muted p-3 rounded">
            {renderTemplate(template.prompt, values)}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={copyToClipboard}>Copy</Button>
          <Button onClick={useInChat}>Use in Chat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

---

### 5. Built-in Template Collection

**Dosya:** `.leah/templates/prompts/` (100+ pre-made templates)

**Categories:**
- **Coding** (25 templates): Code review, refactoring, debugging, optimization, documentation
- **Writing** (20 templates): Blog posts, emails, reports, creative writing, summarization
- **Analysis** (15 templates): Data analysis, SWOT, competitive analysis, root cause
- **Translation** (10 templates): Languages, tone preservation, localization
- **Education** (15 templates): Explain concepts, create quizzes, study guides, lesson plans
- **Business** (15 templates): Business plans, proposals, meeting notes, job descriptions

---

## 📁 Yeni Dosyalar

### Core
1. `core/src/types/prompts/template.ts`
2. `core/src/browser/extensions/template-manager.ts`

### Extension
3. `extensions/template-manager-extension/` (yeni)

### Web App
4. `web-app/src/routes/prompts/library.tsx`
5. `web-app/src/routes/prompts/editor.tsx`
6. `web-app/src/components/prompts/TemplateEditor.tsx`
7. `web-app/src/components/prompts/TemplateCard.tsx`
8. `web-app/src/components/prompts/TemplateUseDialog.tsx`
9. `web-app/src/components/prompts/VariableInput.tsx`
10. `web-app/src/hooks/useTemplates.ts`

### Templates
11. `.leah/templates/prompts/*.json` (100+ templates)

---

## ⚡ Performans

1. **Loading:** Lazy load templates (virtual scrolling)
2. **Search:** Fuse.js for fuzzy search
3. **Rendering:** Memoize rendered templates
4. **Storage:** IndexedDB for templates

---

## 🚀 Implementation: 8-10 gün

1. **Gün 1-2:** Types, template manager extension
2. **Gün 3-4:** UI components (library, editor)
3. **Gün 5-6:** Template rendering engine
4. **Gün 7-8:** Built-in template collection
5. **Gün 9-10:** Import/export, testing

---

## 📊 Başarı Kriterleri

1. ✅ 100+ professional templates included
2. ✅ Template rendering < 50ms
3. ✅ Search results < 100ms
4. ✅ Editor auto-saves every 5s
5. ✅ Import/export working for all formats

---

## 🎯 Next Phase: Phase 7 - Performance Monitor & Dashboard
