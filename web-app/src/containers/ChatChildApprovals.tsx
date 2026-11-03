import { useMemo } from 'react'
import {
  Tool,
  ToolApprovalActions,
  ToolContent,
  ToolHeader,
} from '@/components/ai-elements/tool'
import { useChildApprovalCalls } from '@/hooks/useChildApprovalCalls'
import { approvalKey, useToolApprovalRequests } from '@/hooks/useToolApprovalRequests'

const NONE: readonly string[] = []

/**
 * Pending approvals for tool calls made by `task` children of this thread,
 * shown above the composer. Children have no transcript part to host the
 * standard card, so the existing Tool + ToolApprovalActions render here and
 * resolve through the same approval store (no auto-approve path). A card is
 * shown only while the route owns the call AND its prompt is pending, so
 * cancel, Stop, settle and thread deletion remove it, and parent prompts (which
 * the transcript already renders) never appear twice.
 */
export function ChatChildApprovals({ threadId }: { threadId: string }) {
  const owned = useChildApprovalCalls((s) => s.owned[threadId] ?? NONE)
  const pending = useToolApprovalRequests((s) => s.pending)

  const requests = useMemo(
    () =>
      owned.flatMap((callId) => {
        const request = pending?.[approvalKey(threadId, callId)]
        return request && request.threadId === threadId ? [request] : []
      }),
    [owned, pending, threadId]
  )

  if (!requests.length) return null
  return (
    <div className="pb-2 space-y-2" data-testid="chat-child-approvals">
      {requests.map((request) => (
        <Tool
          key={approvalKey(request.threadId, request.toolCallId)}
          state="input-available"
          toolCallId={request.toolCallId}
          threadId={request.threadId}
          defaultOpen
        >
          <ToolHeader
            title={request.toolName}
            type={`tool-${request.toolName}` as `tool-${string}`}
            state="input-available"
            origin={request.serverName}
          />
          <ToolContent title={request.toolName}>
            <ToolApprovalActions />
          </ToolContent>
        </Tool>
      ))}
    </div>
  )
}

export default ChatChildApprovals
