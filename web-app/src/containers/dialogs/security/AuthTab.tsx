import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconKey,
  IconLoader2,
} from '@tabler/icons-react'
import type { AuthMode, SecurityStatus } from '@/hooks/useSecurityConfig'

function maskToken(token: string): string {
  if (token.length <= 8) return '*'.repeat(token.length)
  return token.slice(0, 4) + '*'.repeat(token.length - 8) + token.slice(-4)
}

export function AuthTab(props: {
  status: SecurityStatus | null
  authMode: AuthMode
  isChangingAuthMode: boolean
  generatedToken: string | null
  showToken: boolean
  setShowToken: (value: boolean) => void
  tokenCopied: boolean
  handleAuthModeChange: (mode: AuthMode) => Promise<void>
  handleGenerateToken: () => Promise<void>
  handleCopyToken: () => Promise<void>
  isGeneratingToken: boolean
  showPassword: boolean
  setShowPassword: (value: boolean) => void
  password: string
  setPassword: (value: string) => void
  confirmPassword: string
  setConfirmPassword: (value: string) => void
  isSettingPassword: boolean
  handleSetPassword: () => Promise<void>
}) {
  const {
    status,
    authMode,
    isChangingAuthMode,
    generatedToken,
    showToken,
    setShowToken,
    tokenCopied,
    handleAuthModeChange,
    handleGenerateToken,
    handleCopyToken,
    isGeneratingToken,
    showPassword,
    setShowPassword,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    isSettingPassword,
    handleSetPassword,
  } = props

  return (
    <div className="space-y-6">
      {status && (
        <div className="bg-secondary/30 rounded-lg p-4 space-y-2">
          <h4 className="font-medium text-foreground text-sm">Current Status</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-muted-foreground">Auth Mode:</span>
            <span className="text-foreground capitalize">{status.auth_mode}</span>
            <span className="text-muted-foreground">Has Token:</span>
            <span className="text-foreground">{status.has_token ? 'Yes' : 'No'}</span>
            <span className="text-muted-foreground">Has Password:</span>
            <span className="text-foreground">{status.has_password ? 'Yes' : 'No'}</span>
            {status.recent_auth_failures > 0 && (
              <>
                <span className="text-muted-foreground">Recent Failures:</span>
                <span className="text-destructive">{status.recent_auth_failures}</span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground">
          Authentication Mode
        </label>
        <RadioGroup
          value={authMode}
          onValueChange={(value) => handleAuthModeChange(value as AuthMode)}
          className="space-y-2"
          disabled={isChangingAuthMode}
        >
          <div className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
            <RadioGroupItem value="token" id="auth-token" />
            <label htmlFor="auth-token" className="flex-1 cursor-pointer">
              <span className="font-medium text-foreground">Token</span>
              <p className="text-sm text-muted-foreground">
                Require a secret token for API access
              </p>
            </label>
          </div>
          <div className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
            <RadioGroupItem value="password" id="auth-password" />
            <label htmlFor="auth-password" className="flex-1 cursor-pointer">
              <span className="font-medium text-foreground">Password</span>
              <p className="text-sm text-muted-foreground">
                Require a password for access
              </p>
            </label>
          </div>
          <div className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
            <RadioGroupItem value="none" id="auth-none" />
            <label htmlFor="auth-none" className="flex-1 cursor-pointer">
              <span className="font-medium text-foreground">None</span>
              <p className="text-sm text-muted-foreground">
                No authentication required (not recommended)
              </p>
            </label>
          </div>
        </RadioGroup>
      </div>

      {authMode === 'token' && (
        <div className="space-y-3 p-4 border border-border rounded-lg">
          <h4 className="font-medium text-foreground">Access Token</h4>

          {generatedToken ? (
            <div className="space-y-3">
              <div className="bg-secondary/50 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono text-foreground break-all">
                    {showToken ? generatedToken : maskToken(generatedToken)}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={handleCopyToken}>
                    {tokenCopied ? (
                      <IconCheck size={16} className="text-green-500" />
                    ) : (
                      <IconCopy size={16} />
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex items-start gap-2 text-amber-500 text-sm">
                <IconAlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>
                  Save this token now. It cannot be retrieved later. You will need
                  to generate a new one if lost.
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {status?.has_token
                ? 'A token is already configured. Generate a new one to replace it.'
                : 'No token configured. Generate one to enable token authentication.'}
            </p>
          )}

          <Button
            onClick={handleGenerateToken}
            disabled={isGeneratingToken}
            variant="outline"
            size="sm"
          >
            {isGeneratingToken ? (
              <>
                <IconLoader2 className="animate-spin mr-2 h-4 w-4" />
                Generating...
              </>
            ) : (
              <>
                <IconKey className="mr-2 h-4 w-4" />
                Generate New Token
              </>
            )}
          </Button>
        </div>
      )}

      {authMode === 'password' && (
        <div className="space-y-3 p-4 border border-border rounded-lg">
          <h4 className="font-medium text-foreground">Set Password</h4>
          <p className="text-sm text-muted-foreground">
            {status?.has_password
              ? 'Enter a new password to replace the existing one.'
              : 'Set a password to enable password authentication.'}
          </p>

          <div className="space-y-3">
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="pr-10"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              </Button>
            </div>
            <Input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
            />
            {password && confirmPassword && password !== confirmPassword && (
              <p className="text-sm text-destructive">Passwords do not match</p>
            )}
            {password && password.length < 8 && (
              <p className="text-sm text-amber-500">
                Password must be at least 8 characters
              </p>
            )}
          </div>

          <Button
            onClick={handleSetPassword}
            disabled={
              isSettingPassword ||
              !password ||
              password !== confirmPassword ||
              password.length < 8
            }
            size="sm"
          >
            {isSettingPassword ? (
              <>
                <IconLoader2 className="animate-spin mr-2 h-4 w-4" />
                Setting...
              </>
            ) : (
              'Set Password'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
