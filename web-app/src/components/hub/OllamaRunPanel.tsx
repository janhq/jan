import { FormEvent, useState } from 'react'
import { ModelCombobox } from '@/containers/ModelCombobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  OLLAMA_RUN_ADVANCED_OPTION_FIELDS,
  OLLAMA_RUN_ADVANCED_REQUEST_FIELDS,
  OLLAMA_RUN_COMMON_FIELDS,
  OLLAMA_RUN_FIELD_KIND_MAP,
  OLLAMA_RUN_THINK_VALUES,
  OllamaRunFormState,
  buildOllamaRunPayload,
} from './ollamaRunSchema'

type OllamaRunPanelProps = {
  models: string[]
  isSubmitting: boolean
  onSubmit: (payload: Record<string, unknown>) => void
}

const SELECT_CLASS_NAME =
  'border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50'

const nullableBooleanValue = (value: unknown): '' | 'true' | 'false' => {
  if (value === true) return 'true'
  if (value === false) return 'false'
  return ''
}

const parseNullableBooleanValue = (value: string): boolean | null => {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

export function OllamaRunPanel({
  models,
  isSubmitting,
  onSubmit,
}: OllamaRunPanelProps) {
  const [form, setForm] = useState<OllamaRunFormState>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const model = typeof form.model === 'string' ? form.model : ''
  const trimmedModel = model.trim()
  const modelMissing = trimmedModel === ''
  const modelAvailable = !modelMissing && models.includes(trimmedModel)
  const commonFields = OLLAMA_RUN_COMMON_FIELDS.filter((field) => field !== 'model')
  const modelInputId = 'ollama-run-model'

  const handleModelChange = (value: string) => {
    setSubmitError(null)
    setForm((prev) => ({ ...prev, model: value }))
  }

  const handleFieldChange = (field: string, value: unknown) => {
    setSubmitError(null)
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!modelAvailable || isSubmitting) return

    try {
      setSubmitError(null)
      onSubmit(buildOllamaRunPayload(form))
    } catch (error) {
      const message = error instanceof Error ? error.message : '提交参数校验失败'
      setSubmitError(message)
    }
  }

  const modelHint = modelMissing
    ? '请选择 model'
    : modelAvailable
      ? null
      : '请选择可用的 model'

  const renderField = (field: string) => {
    const value = form[field as keyof OllamaRunFormState]
    const id = `ollama-run-${field}`
    const kind = OLLAMA_RUN_FIELD_KIND_MAP[field as keyof typeof OLLAMA_RUN_FIELD_KIND_MAP]

    if (kind === 'boolean') {
      return (
        <div key={field} className="flex items-center justify-between gap-3">
          <label htmlFor={id} className="text-sm text-foreground">
            {field}
          </label>
          <Switch
            id={id}
            checked={Boolean(value)}
            onCheckedChange={(checked) => handleFieldChange(field, checked)}
          />
        </div>
      )
    }

    if (kind === 'nullable-boolean') {
      return (
        <div key={field} className="grid gap-1.5">
          <label htmlFor={id} className="text-sm text-foreground">
            {field}
          </label>
          <select
            id={id}
            aria-label={field}
            className={SELECT_CLASS_NAME}
            value={nullableBooleanValue(value)}
            onChange={(event) =>
              handleFieldChange(field, parseNullableBooleanValue(event.target.value))
            }
          >
            <option value="">未设置</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
      )
    }

    if (kind === 'think') {
      return (
        <div key={field} className="grid gap-1.5">
          <label htmlFor={id} className="text-sm text-foreground">
            {field}
          </label>
          <select
            id={id}
            aria-label={field}
            className={SELECT_CLASS_NAME}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => handleFieldChange(field, event.target.value)}
          >
            {OLLAMA_RUN_THINK_VALUES.map((optionValue) => (
              <option key={optionValue || 'empty'} value={optionValue}>
                {optionValue || '未设置'}
              </option>
            ))}
          </select>
        </div>
      )
    }

    if (kind === 'textarea' || kind === 'json' || kind === 'string-list') {
      return (
        <div key={field} className="grid gap-1.5">
          <label htmlFor={id} className="text-sm text-foreground">
            {field}
          </label>
          <Textarea
            id={id}
            aria-label={field}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => handleFieldChange(field, event.target.value)}
          />
        </div>
      )
    }

    return (
      <div key={field} className="grid gap-1.5">
        <label htmlFor={id} className="text-sm text-foreground">
          {field}
        </label>
        <Input
          id={id}
          aria-label={field}
          type={kind === 'number' ? 'number' : 'text'}
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          onChange={(event) => handleFieldChange(field, event.target.value)}
        />
      </div>
    )
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <div className="grid gap-1.5">
        <label htmlFor={modelInputId} className="text-sm text-foreground">
          model
        </label>
        <ModelCombobox
          value={model}
          onChange={handleModelChange}
          models={models}
          placeholder="输入或选择模型..."
          inputId={modelInputId}
          inputAriaLabel="model"
        />
        {modelHint && <p className="text-xs text-muted-foreground">{modelHint}</p>}
      </div>

      <div className="grid gap-3">
        {commonFields.map((field) => renderField(field))}
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="w-fit">
            高级
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 grid gap-4">
          <div className="grid gap-3">
            {OLLAMA_RUN_ADVANCED_REQUEST_FIELDS.map((field) => renderField(field))}
          </div>
          <div className="grid gap-3">
            {OLLAMA_RUN_ADVANCED_OPTION_FIELDS.map((field) => renderField(field))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!modelAvailable || isSubmitting}>
          {isSubmitting ? '启动中...' : '启动'}
        </Button>
      </div>

      {submitError && (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}
    </form>
  )
}
