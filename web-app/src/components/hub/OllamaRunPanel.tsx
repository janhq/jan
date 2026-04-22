import { type FormEvent, type ReactNode, useState } from 'react'
import { ModelCombobox } from '@/containers/ModelCombobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
  OLLAMA_RUN_FIELD_UI,
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

const getFieldLayoutClassName = (field: keyof typeof OLLAMA_RUN_FIELD_UI) => {
  const layout = OLLAMA_RUN_FIELD_UI[field].layout

  if (layout === 'wide') return 'md:col-span-2 xl:col-span-2'
  if (layout === 'full') return 'md:col-span-2 xl:col-span-4'
  return 'col-span-1'
}

const FieldLabel = ({ field, id }: { field: keyof typeof OLLAMA_RUN_FIELD_UI; id: string }) => (
  <div className="mb-2 flex items-center gap-2">
    <label htmlFor={id} className="text-[12px] font-medium text-foreground">
      {field}
    </label>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`查看 ${field} 参数说明`}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border/70 bg-background/60 text-[10px] font-semibold leading-none text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 text-left leading-5">
        {OLLAMA_RUN_FIELD_UI[field].help}
      </TooltipContent>
    </Tooltip>
  </div>
)

const FieldShell = ({
  field,
  children,
  className,
}: {
  field: keyof typeof OLLAMA_RUN_FIELD_UI
  children: ReactNode
  className?: string
}) => (
  <div
    className={cn(
      'rounded-xl border border-border/60 bg-background/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]',
      getFieldLayoutClassName(field),
      className
    )}
  >
    {children}
  </div>
)

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
    const uiField = field as keyof typeof OLLAMA_RUN_FIELD_UI

    if (kind === 'boolean') {
      return (
        <FieldShell key={field} field={uiField} className="min-h-[86px]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <FieldLabel field={uiField} id={id} />
            </div>
            <Switch
              id={id}
              checked={Boolean(value)}
              onCheckedChange={(checked) => handleFieldChange(field, checked)}
            />
          </div>
        </FieldShell>
      )
    }

    if (kind === 'nullable-boolean') {
      return (
        <FieldShell key={field} field={uiField}>
          <FieldLabel field={uiField} id={id} />
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
        </FieldShell>
      )
    }

    if (kind === 'think') {
      return (
        <FieldShell key={field} field={uiField}>
          <FieldLabel field={uiField} id={id} />
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
        </FieldShell>
      )
    }

    if (kind === 'textarea' || kind === 'json' || kind === 'string-list') {
      return (
        <FieldShell key={field} field={uiField}>
          <FieldLabel field={uiField} id={id} />
          <Textarea
            id={id}
            aria-label={field}
            className={cn(
              'min-h-[88px] resize-y',
              (kind === 'json' || kind === 'string-list') && 'min-h-[104px]'
            )}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => handleFieldChange(field, event.target.value)}
          />
        </FieldShell>
      )
    }

    return (
      <FieldShell key={field} field={uiField}>
        <FieldLabel field={uiField} id={id} />
        <Input
          id={id}
          aria-label={field}
          type={kind === 'number' ? 'number' : 'text'}
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          onChange={(event) => handleFieldChange(field, event.target.value)}
        />
      </FieldShell>
    )
  }

  return (
    <form
      className="grid gap-4 rounded-[22px] border border-border/60 bg-card/95 p-4 shadow-sm md:p-5"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-3 border-b border-border/60 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="text-base font-semibold text-foreground">运行面板</div>
          <p className="text-xs leading-5 text-muted-foreground">
            从本地已下载模型中选择后，直接配置本次启动参数并运行
          </p>
        </div>
        <div className="inline-flex w-fit items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] text-muted-foreground">
          本次启动临时生效
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_220px]">
        <FieldShell field="model" className="min-h-[94px]">
          <FieldLabel field="model" id={modelInputId} />
          <ModelCombobox
            value={model}
            onChange={handleModelChange}
            models={models}
            placeholder="输入或选择模型..."
            inputId={modelInputId}
            inputAriaLabel="model"
          />
          {modelHint && <p className="mt-2 text-xs text-muted-foreground">{modelHint}</p>}
        </FieldShell>
        {renderField('keep_alive')}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            常用参数
          </div>
          <div className="text-[11px] text-muted-foreground">短参数高密度混排</div>
        </div>
        <div
          data-testid="ollama-run-common-grid"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
          {commonFields.map((field) => renderField(field))}
        </div>
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <div className="flex items-center justify-between gap-3">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="rounded-full px-3">
              高级
            </Button>
          </CollapsibleTrigger>
          <div className="text-[11px] text-muted-foreground">展开后显示全部 Ollama 启动参数</div>
        </div>
        <CollapsibleContent className="mt-4 space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Request
            </div>
            <div
              data-testid="ollama-run-advanced-grid"
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
            >
              {OLLAMA_RUN_ADVANCED_REQUEST_FIELDS.map((field) => renderField(field))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Options
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {OLLAMA_RUN_ADVANCED_OPTION_FIELDS.map((field) => renderField(field))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex flex-col gap-3 border-t border-border/60 pt-4 md:flex-row md:items-center md:justify-between">
        <p className="text-xs text-muted-foreground">
          未选模型时，参数区保持显示，仅启动按钮不可用。
        </p>
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
