import { useToolApproval } from '@/hooks/useToolApproval'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ToolApprovalDialog } from '@/containers/dialogs/ToolApprovalDialog'

/**
 * Chat MCP tool-approval modal. Binds the shared `ToolApprovalDialog` to the
 * `useToolApproval` store: allow-once resolves the pending promise without
 * remembering, allow-always approves the tool for the thread, and deny (or
 * closing the dialog) rejects it. Both store callbacks close the modal.
 */
export default function ToolApproval() {
  const { t } = useTranslation()
  const { isModalOpen, modalProps } = useToolApproval()

  if (!modalProps) {
    return null
  }

  const { toolName, toolParameters, onApprove, onDeny } = modalProps

  return (
    <ToolApprovalDialog
      open={isModalOpen}
      toolName={toolName}
      showSecurityNotice
      onDecision={(decision) => {
        if (decision === 'deny') onDeny()
        else onApprove(decision === 'allow-once')
      }}
    >
      {toolParameters && Object.keys(toolParameters).length > 0 && (
        <div className="bg-background p-2 border rounded-lg overflow-x-scroll">
          <h4 className="text-sm font-medium mb-2">
            {t('tools:toolApproval.parameters')}
          </h4>
          <div className="relative bg-secondary rounded-md p-2 text-sm font-mono border overflow-x-auto">
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(toolParameters, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </ToolApprovalDialog>
  )
}
