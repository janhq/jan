import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'

export type AuthMode = 'token' | 'password' | 'none'
export type TabType = 'auth' | 'devices' | 'logs'

export interface SecurityStatus {
  auth_mode: AuthMode
  has_token: boolean
  has_password: boolean
  require_pairing: boolean
  approved_device_count: number
  recent_auth_failures: number
}

export interface DeviceInfo {
  id: string
  name: string
  channel: string
  user_id: string
  approved_at: string
  last_access: string | null
}

export interface AccessLogEntry {
  timestamp: string
  device_id: string | null
  channel: string
  user_id: string
  action: string
  ip_address: string | null
  success: boolean
  error: string | null
}

type ConfirmActionType = 'revoke' | 'clear_logs' | 'change_auth_mode' | null

export function useSecurityConfig({
  isOpen,
  onSave,
}: {
  isOpen: boolean
  onSave?: () => void
}) {
  const [activeTab, setActiveTab] = useState<TabType>('auth')
  const activeTabRef = useRef<TabType>('auth')
  activeTabRef.current = activeTab

  const [status, setStatus] = useState<SecurityStatus | null>(null)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)

  const [authMode, setAuthMode] = useState<AuthMode>('none')
  const [isChangingAuthMode, setIsChangingAuthMode] = useState(false)

  const [generatedToken, setGeneratedToken] = useState<string | null>(null)
  const [isGeneratingToken, setIsGeneratingToken] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSettingPassword, setIsSettingPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [requirePairing, setRequirePairing] = useState(false)
  const [isTogglingPairing, setIsTogglingPairing] = useState(false)

  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [isLoadingDevices, setIsLoadingDevices] = useState(false)
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null)

  const [logs, setLogs] = useState<AccessLogEntry[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [isClearingLogs, setIsClearingLogs] = useState(false)

  const [confirmAction, setConfirmAction] = useState<{
    type: ConfirmActionType
    data?: unknown
  }>({ type: null })

  const fetchStatus = useCallback(async () => {
    setIsLoadingStatus(true)
    try {
      const result = await invoke<SecurityStatus>('security_get_status')
      setStatus(result)
      setAuthMode(result.auth_mode)
      setRequirePairing(result.require_pairing)
    } catch {
      toast.error('Failed to load security settings')
    } finally {
      setIsLoadingStatus(false)
    }
  }, [])

  const fetchDevices = useCallback(async () => {
    setIsLoadingDevices(true)
    try {
      const result = await invoke<DeviceInfo[]>('security_get_devices')
      setDevices(result)
    } catch {
      toast.error('Failed to load devices')
    } finally {
      setIsLoadingDevices(false)
    }
  }, [])

  const fetchLogs = useCallback(async () => {
    setIsLoadingLogs(true)
    try {
      const result = await invoke<AccessLogEntry[]>('security_get_logs', {
        limit: 100,
      })
      setLogs(result)
    } catch {
      toast.error('Failed to load access logs')
    } finally {
      setIsLoadingLogs(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    fetchStatus()
    setGeneratedToken(null)
    setPassword('')
    setConfirmPassword('')
    setShowToken(false)
    setShowPassword(false)
    const tab = activeTabRef.current
    if (tab === 'devices') void fetchDevices()
    if (tab === 'logs') void fetchLogs()
  }, [isOpen, fetchStatus, fetchDevices, fetchLogs])

  const changeAuthMode = useCallback(
    async (newMode: AuthMode) => {
      setIsChangingAuthMode(true)
      try {
        await invoke('security_set_auth_mode', { mode: newMode })
        setAuthMode(newMode)
        setGeneratedToken(null)
        await fetchStatus()
        toast.success(`Authentication mode changed to ${newMode}`)
        onSave?.()
      } catch {
        toast.error('Failed to change authentication mode')
      } finally {
        setIsChangingAuthMode(false)
        setConfirmAction({ type: null })
      }
    },
    [fetchStatus, onSave]
  )

  const handleAuthModeChange = useCallback(
    async (newMode: AuthMode) => {
      if (newMode === authMode) return
      if (authMode !== 'none' && newMode !== authMode) {
        setConfirmAction({ type: 'change_auth_mode', data: newMode })
        return
      }
      await changeAuthMode(newMode)
    },
    [authMode, changeAuthMode]
  )

  const handleGenerateToken = useCallback(async () => {
    setIsGeneratingToken(true)
    try {
      const token = await invoke<string>('security_generate_token')
      setGeneratedToken(token)
      setShowToken(true)
      await fetchStatus()
      toast.success('New access token generated')
      onSave?.()
    } catch {
      toast.error('Failed to generate token')
    } finally {
      setIsGeneratingToken(false)
    }
  }, [fetchStatus, onSave])

  const handleCopyToken = useCallback(async () => {
    if (!generatedToken) return
    try {
      await navigator.clipboard.writeText(generatedToken)
      setTokenCopied(true)
      toast.success('Token copied to clipboard')
      setTimeout(() => setTokenCopied(false), 2000)
    } catch {
      toast.error('Failed to copy token')
    }
  }, [generatedToken])

  const handleSetPassword = useCallback(async () => {
    if (!password || password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setIsSettingPassword(true)
    try {
      await invoke('security_set_password', { password })
      setPassword('')
      setConfirmPassword('')
      await fetchStatus()
      toast.success('Password set successfully')
      onSave?.()
    } catch {
      toast.error('Failed to set password')
    } finally {
      setIsSettingPassword(false)
    }
  }, [password, confirmPassword, fetchStatus, onSave])

  const handleTogglePairing = useCallback(
    async (enabled: boolean) => {
      setIsTogglingPairing(true)
      try {
        await invoke('security_set_require_pairing', { require: enabled })
        setRequirePairing(enabled)
        await fetchStatus()
        toast.success(
          enabled ? 'Device pairing required' : 'Device pairing disabled'
        )
        onSave?.()
      } catch {
        toast.error('Failed to update pairing setting')
      } finally {
        setIsTogglingPairing(false)
      }
    },
    [fetchStatus, onSave]
  )

  const handleRevokeDevice = useCallback(
    async (deviceId: string) => {
      setRevokingDeviceId(deviceId)
      try {
        await invoke('security_revoke_device', { device_id: deviceId })
        await fetchDevices()
        await fetchStatus()
        toast.success('Device access revoked')
        onSave?.()
      } catch {
        toast.error('Failed to revoke device access')
      } finally {
        setRevokingDeviceId(null)
        setConfirmAction({ type: null })
      }
    },
    [fetchDevices, fetchStatus, onSave]
  )

  const handleClearLogs = useCallback(async () => {
    setIsClearingLogs(true)
    try {
      await invoke('security_clear_logs')
      setLogs([])
      toast.success('Access logs cleared')
    } catch {
      toast.error('Failed to clear logs')
    } finally {
      setIsClearingLogs(false)
      setConfirmAction({ type: null })
    }
  }, [])

  return {
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
  }
}
