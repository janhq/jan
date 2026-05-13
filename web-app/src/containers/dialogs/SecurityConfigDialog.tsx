import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  IconShield,
  IconKey,
  IconDevices,
  IconHistory,
  IconLoader2,
} from '@tabler/icons-react'
import { useSecurityConfig } from '@/hooks/useSecurityConfig'
import { AuthTab } from './security/AuthTab'
import { DevicesTab } from './security/DevicesTab'
import { LogsTab } from './security/LogsTab'

type SecurityConfigDialogProps = {
  isOpen: boolean
  onClose: () => void
  onSave?: () => void
}

export function SecurityConfigDialog({
  isOpen,
  onClose,
  onSave,
}: SecurityConfigDialogProps) {
  const {
    activeTab,
    setActiveTab,
    status,
    isLoadingStatus,
    authMode,
    isChangingAuthMode,
    generatedToken,
    isGeneratingToken,
    showToken,
    setShowToken,
    tokenCopied,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    isSettingPassword,
    showPassword,
    setShowPassword,
    requirePairing,
    isTogglingPairing,
    devices,
    isLoadingDevices,
    revokingDeviceId,
    logs,
    isLoadingLogs,
    isClearingLogs,
    confirmAction,
    setConfirmAction,
    changeAuthMode,
    fetchDevices,
    fetchLogs,
    handleAuthModeChange,
    handleGenerateToken,
    handleCopyToken,
    handleSetPassword,
    handleTogglePairing,
    handleRevokeDevice,
    handleClearLogs,
  } = useSecurityConfig({ isOpen, onSave })

  // While loading, avoid native disabled on tab buttons: getByRole('button', …) excludes disabled
  // controls by default. Use aria-disabled + click guard so labels stay queryable.
  const renderTabs = (tabsDisabled: boolean) => (
    <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg mb-4">
      <button
        type="button"
        aria-disabled={tabsDisabled}
        onClick={() => {
          if (tabsDisabled) return
          setActiveTab('auth')
        }}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center',
          activeTab === 'auth'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
          tabsDisabled && 'cursor-not-allowed opacity-60'
        )}
      >
        <IconKey size={16} />
        Authentication
      </button>
      <button
        type="button"
        aria-disabled={tabsDisabled}
        onClick={() => {
          if (tabsDisabled) return
          setActiveTab('devices')
          void fetchDevices()
        }}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center',
          activeTab === 'devices'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
          tabsDisabled && 'cursor-not-allowed opacity-60'
        )}
      >
        <IconDevices size={16} />
        Devices
      </button>
      <button
        type="button"
        aria-disabled={tabsDisabled}
        onClick={() => {
          if (tabsDisabled) return
          setActiveTab('logs')
          void fetchLogs()
        }}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center',
          activeTab === 'logs'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
          tabsDisabled && 'cursor-not-allowed opacity-60'
        )}
      >
        <IconHistory size={16} />
        Logs
      </button>
    </div>
  )

  // Render confirm dialog
  const renderConfirmDialog = () => {
    if (!confirmAction.type) return null

    let title = ''
    let description = ''
    let confirmText = ''
    let onConfirm = () => {}

    switch (confirmAction.type) {
      case 'revoke':
        title = 'Revoke Device Access'
        description =
          'Are you sure you want to revoke access for this device? The device will need to be approved again to access.'
        confirmText = 'Revoke'
        onConfirm = () => handleRevokeDevice(confirmAction.data as string)
        break
      case 'clear_logs':
        title = 'Clear Access Logs'
        description =
          'Are you sure you want to clear all access logs? This action cannot be undone.'
        confirmText = 'Clear Logs'
        onConfirm = handleClearLogs
        break
      case 'change_auth_mode':
        title = 'Change Authentication Mode'
        description =
          'Changing the authentication mode will affect how clients access your Jan instance. Are you sure you want to continue?'
        confirmText = 'Change'
        onConfirm = () => changeAuthMode(confirmAction.data as 'none' | 'token' | 'password')
        break
    }

    return (
      <Dialog
        open={!!confirmAction.type}
        onOpenChange={() => setConfirmAction({ type: null })}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmAction({ type: null })}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={onConfirm}>
              {confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[560px] max-w-[90vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <IconShield size={24} className="text-primary" />
              <DialogTitle>Security Settings</DialogTitle>
            </div>
            <DialogDescription>
              Configure authentication, device management, and view access logs
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {renderTabs(isLoadingStatus)}
            {isLoadingStatus ? (
              <div
                className="flex flex-1 items-center justify-center py-12"
                aria-busy="true"
                aria-label="Loading security settings"
              >
                <IconLoader2 className="animate-spin h-8 w-8 text-muted-foreground" />
              </div>
            ) : (
              <>
                {activeTab === 'auth' && (
                  <AuthTab
                    status={status}
                    authMode={authMode}
                    isChangingAuthMode={isChangingAuthMode}
                    generatedToken={generatedToken}
                    showToken={showToken}
                    setShowToken={setShowToken}
                    tokenCopied={tokenCopied}
                    handleAuthModeChange={handleAuthModeChange}
                    handleGenerateToken={handleGenerateToken}
                    handleCopyToken={handleCopyToken}
                    isGeneratingToken={isGeneratingToken}
                    showPassword={showPassword}
                    setShowPassword={setShowPassword}
                    password={password}
                    setPassword={setPassword}
                    confirmPassword={confirmPassword}
                    setConfirmPassword={setConfirmPassword}
                    isSettingPassword={isSettingPassword}
                    handleSetPassword={handleSetPassword}
                  />
                )}
                {activeTab === 'devices' && (
                  <DevicesTab
                    requirePairing={requirePairing}
                    isTogglingPairing={isTogglingPairing}
                    handleTogglePairing={handleTogglePairing}
                    fetchDevices={fetchDevices}
                    isLoadingDevices={isLoadingDevices}
                    devices={devices}
                    revokingDeviceId={revokingDeviceId}
                    onConfirmRevoke={(deviceId) =>
                      setConfirmAction({ type: 'revoke', data: deviceId })
                    }
                  />
                )}
                {activeTab === 'logs' && (
                  <LogsTab
                    fetchLogs={fetchLogs}
                    isLoadingLogs={isLoadingLogs}
                    isClearingLogs={isClearingLogs}
                    logs={logs}
                    onConfirmClear={() => setConfirmAction({ type: 'clear_logs' })}
                  />
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {renderConfirmDialog()}
    </>
  )
}

export default SecurityConfigDialog
