import React, { useState, useMemo } from 'react'
import type { UIMessage } from 'ai'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileCode,
  CheckCircle2,
  XCircle,
  Loader2,
  ListTodo,
  AlertTriangle,
} from 'lucide-react'
import { CodeBlock } from './code-block'

export type CodexActivityPartProps = {
  part: {
    type: 'data-codex-event'
    id?: string
    data: any
  }
  partIndex: number
  message: UIMessage
}

export const CodexActivityPart: React.FC<CodexActivityPartProps> = ({
  part,
  message,
}) => {
  const [isOpen, setIsOpen] = useState(true)
  const event = part.data

  if (!event || typeof event !== 'object') return null

  const threadLabel = event.threadId ? ` (thread ${event.threadId})` : ''
  const isLikelySubagent =
    !!event.threadId ||
    (event.type && (event.type.includes('sub') || event.type.includes('agent')))

  // Helper: Find item_started details for an itemId to get initial context (like command string or file path)
  const itemStarted = useMemo(() => {
    if (!event.itemId) return null
    const startedPart = message.parts.find(
      (p: any) =>
        p.type === 'data-codex-event' &&
        p.data?.type === 'item_started' &&
        p.data?.itemId === event.itemId
    ) as any
    return startedPart?.data?.item
  }, [message.parts, event.itemId])

  // Helper: Find item_completed details to get exit code or success status
  const itemCompleted = useMemo(() => {
    if (!event.itemId) return null
    const completedPart = message.parts.find(
      (p: any) =>
        p.type === 'data-codex-event' &&
        p.data?.type === 'item_completed' &&
        p.data?.itemId === event.itemId
    ) as any
    return completedPart?.data?.item
  }, [message.parts, event.itemId])

  // 1. Render COMMAND OUTPUT
  if (event.type === 'command_output') {
    const command = itemStarted?.command || 'Running command...'
    const isCompleted = !!itemCompleted
    const isFailed = isCompleted && itemCompleted.status === 'failed'

    return (
      <div className="w-full my-2 border rounded-lg bg-neutral-900/40 backdrop-blur-xs border-neutral-800 overflow-hidden shadow-xs">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex items-center justify-between px-4 py-2 bg-neutral-900/60 border-b border-neutral-800">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-xs font-mono text-neutral-300 hover:text-white cursor-pointer select-none">
                {isOpen ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <Terminal size={14} className="text-sky-400" />
                <span className="truncate max-w-[250px] md:max-w-[400px]">
                  {command}
                  {isLikelySubagent ? ' [subagent]' : ''}
                  {threadLabel}
                </span>
              </button>
            </CollapsibleTrigger>
            <div className="flex items-center gap-2">
              {!isCompleted ? (
                <span className="flex items-center gap-1 text-[10px] text-sky-400 font-mono">
                  <Loader2 size={12} className="animate-spin" />
                  RUNNING
                </span>
              ) : isFailed ? (
                <span className="flex items-center gap-1 text-[10px] text-rose-400 font-mono">
                  <XCircle size={12} />
                  FAILED
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                  <CheckCircle2 size={12} />
                  SUCCESS
                </span>
              )}
            </div>
          </div>
          <CollapsibleContent>
            <div className="p-3 font-mono text-xs bg-neutral-950 text-neutral-300 overflow-x-auto max-h-[300px]">
              <pre className="whitespace-pre-wrap">{event.output}</pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  }

  // 2. Render FILE CHANGE
  if (event.type === 'file_change' || event.type === 'file_change_patch') {
    const path = itemStarted?.path || 'file'
    const patchText = event.patch || ''

    return (
      <div className="w-full my-2 border rounded-lg bg-neutral-900/40 backdrop-blur-xs border-neutral-800 overflow-hidden shadow-xs">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex items-center justify-between px-4 py-2 bg-neutral-900/60 border-b border-neutral-800">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-xs font-mono text-neutral-300 hover:text-white cursor-pointer select-none">
                {isOpen ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <FileCode size={14} className="text-emerald-400" />
                <span className="truncate max-w-[250px] md:max-w-[400px]">
                  {path}
                  {isLikelySubagent ? ' [subagent]' : ''}
                  {threadLabel}
                </span>
              </button>
            </CollapsibleTrigger>
            <span className="text-[10px] text-emerald-400 font-mono">DIFF</span>
          </div>
          <CollapsibleContent>
            <div className="text-xs max-h-[400px] overflow-auto">
              <CodeBlock code={patchText} language="diff" />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  }

  // 3. Render AGENT PLAN
  if (event.type === 'plan') {
    return (
      <div className="w-full my-2 border rounded-lg bg-neutral-900/40 backdrop-blur-xs border-neutral-800 overflow-hidden shadow-xs">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex items-center justify-between px-4 py-2 bg-neutral-900/60 border-b border-neutral-800">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-xs font-mono text-neutral-300 hover:text-white cursor-pointer select-none">
                {isOpen ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <ListTodo size={14} className="text-indigo-400" />
                <span>
                  Execution Plan{isLikelySubagent ? ' [subagent]' : ''}
                  {threadLabel}
                </span>
              </button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <div className="p-4 text-sm text-neutral-300 bg-neutral-950/20 leading-relaxed max-h-[300px] overflow-auto">
              <CodeBlock code={event.plan} language="markdown" />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  }

  // 4. Render PROCESS TERMINAL OUTPUT (from background terminal)
  if (event.type === 'process_output') {
    return (
      <div className="w-full my-2 border rounded-lg bg-neutral-900/40 backdrop-blur-xs border-neutral-800 overflow-hidden shadow-xs">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex items-center justify-between px-4 py-2 bg-neutral-900/60 border-b border-neutral-800">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-xs font-mono text-neutral-300 hover:text-white cursor-pointer select-none">
                {isOpen ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <Terminal size={14} className="text-amber-400" />
                <span>Terminal (Process {event.processHandle})</span>
              </button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <div className="p-3 font-mono text-xs bg-neutral-950 text-neutral-300 overflow-x-auto max-h-[300px]">
              <pre className="whitespace-pre-wrap">{event.output}</pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  }

  // 5. Render WARNINGS/NOTIFICATIONS inline
  if (event.type === 'warning') {
    return (
      <div className="flex items-start gap-2 p-2 my-2 border rounded-md border-amber-900/30 bg-amber-950/20 text-amber-300 text-xs">
        <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-400" />
        <span className="font-mono">{event.message}</span>
      </div>
    )
  }

  // 6. Render thread status updates (often used by Codex for subagent/child agent threads)
  if (event.type === 'thread_status') {
    const statusStr =
      typeof event.status === 'string'
        ? event.status
        : JSON.stringify(event.status || {})
    return (
      <div className="flex items-start gap-2 p-2 my-2 border rounded-md border-violet-900/30 bg-violet-950/20 text-violet-300 text-xs font-mono">
        <span>
          Agent thread{threadLabel} status: {statusStr}
        </span>
      </div>
    )
  }

  // Default fallback for started/completed indicators (hidden or basic status)
  return null
}
