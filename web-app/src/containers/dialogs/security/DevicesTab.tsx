import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { IconDevices, IconLoader2, IconRefresh, IconTrash } from '@tabler/icons-react'
import type { DeviceInfo } from '@/hooks/useSecurityConfig'

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString()
  } catch {
    return dateStr
  }
}

export function DevicesTab(props: {
  requirePairing: boolean
  isTogglingPairing: boolean
  handleTogglePairing: (enabled: boolean) => Promise<void>
  fetchDevices: () => Promise<void>
  isLoadingDevices: boolean
  devices: DeviceInfo[]
  revokingDeviceId: string | null
  onConfirmRevoke: (deviceId: string) => void
}) {
  const {
    requirePairing,
    isTogglingPairing,
    handleTogglePairing,
    fetchDevices,
    isLoadingDevices,
    devices,
    revokingDeviceId,
    onConfirmRevoke,
  } = props

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-4 border border-border rounded-lg">
        <div className="space-y-1">
          <h4 className="font-medium text-foreground">Require Device Pairing</h4>
          <p className="text-sm text-muted-foreground">
            Devices must be approved before they can access
          </p>
        </div>
        <Switch
          checked={requirePairing}
          onCheckedChange={handleTogglePairing}
          loading={isTogglingPairing}
          disabled={isTogglingPairing}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-foreground">Approved Devices</h4>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={fetchDevices}
            disabled={isLoadingDevices}
          >
            <IconRefresh size={16} className={cn(isLoadingDevices && 'animate-spin')} />
          </Button>
        </div>

        {isLoadingDevices ? (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="animate-spin h-6 w-6 text-muted-foreground" />
          </div>
        ) : devices.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <IconDevices size={32} className="mx-auto mb-2 opacity-50" />
            <p>No approved devices</p>
          </div>
        ) : (
          <div className="space-y-2">
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">
                      {device.name}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                      {device.channel}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <span>User: {device.user_id}</span>
                    <span className="mx-2">|</span>
                    <span>Approved: {formatDate(device.approved_at)}</span>
                    {device.last_access && (
                      <>
                        <span className="mx-2">|</span>
                        <span>Last: {formatDate(device.last_access)}</span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onConfirmRevoke(device.id)}
                  disabled={revokingDeviceId === device.id}
                  className="shrink-0 text-destructive hover:text-destructive"
                >
                  {revokingDeviceId === device.id ? (
                    <IconLoader2 className="animate-spin h-4 w-4" />
                  ) : (
                    <IconTrash size={16} />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
