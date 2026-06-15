import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import posthog from 'posthog-js'
import { toast } from 'sonner'
import {
  IconChevronDown,
  IconExternalLink,
  IconLoader2,
  IconTerminal2,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import {
  INTEGRATION_AGENTS,
  type IntegrationAgent,
} from '@/constants/integrations'
import HeaderPage from '@/containers/HeaderPage'
import { Card } from '@/containers/Card'
import { LocalApiServerPanel } from '@/containers/LocalApiServerPanel'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useLaunchStore } from '@/stores/launch-store'
import { cn } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.launch.index as any)({
  component: LaunchPage,
})

// Only reveal the in-button spinner once an action has been running longer
// than this; near-instant config writes finish first and never flash it.
const SPINNER_DELAY_MS = 350

function IconBox({
  children,
  bg,
}: {
  children: ReactNode
  bg?: string
}) {
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md"
      style={bg ? { backgroundColor: bg } : undefined}
    >
      {children}
    </div>
  )
}

function AgentIcon({ agent }: { agent: IntegrationAgent }) {
  switch (agent.id) {
    case 'claude-code':
      return (
        <IconBox bg="#1f1e1d">
          <svg
            width="24"
            height="18"
            viewBox="0 0 99 72"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M9 0H90V54H9V0Z" fill="#D77757" />
            <path d="M0 18H9V36H0V18Z" fill="#D77757" />
            <path d="M18 18H27V27H18V18Z" fill="#1f1e1d" />
            <path d="M72 18H81V27H72V18Z" fill="#1f1e1d" />
            <path d="M90 18H99V36H90V18Z" fill="#D77757" />
            <path d="M9 54H18V72H9V54Z" fill="#D77757" />
            <path d="M63 54H72V72H63V54Z" fill="#D77757" />
            <path d="M27 54H36V72H27V54Z" fill="#D77757" />
            <path d="M81 54H90V72H81V54Z" fill="#D77757" />
          </svg>
        </IconBox>
      )
    case 'codex':
      return (
        <IconBox bg="#000000">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="#ffffff"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
          </svg>
        </IconBox>
      )
    case 'opencode':
      return (
        <IconBox bg="#1a1717">
          <svg
            width="22"
            height="22"
            viewBox="0 0 300 300"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g transform="translate(30, 0)">
              <path d="M180 240H60V120H180V240Z" fill="#4B4646" />
              <path
                d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
                fill="#F1ECEC"
              />
            </g>
          </svg>
        </IconBox>
      )
    case 'mimo':
      return (
        <IconBox bg="#ff6700">
          <span className="text-sm font-semibold text-white">
            {agent.name.charAt(0)}
          </span>
        </IconBox>
      )
    case 'copilot':
      return (
        <IconBox bg="#000000">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="#ffffff"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z" />
          </svg>
        </IconBox>
      )
    case 'droid':
      return (
        <IconBox bg="#020202">
          <svg
            width="22"
            height="22"
            viewBox="0 0 508 508"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M321.997 150.712C321.401 150.568 320.844 150.299 320.363 149.925C319.883 149.551 319.491 149.08 319.215 148.544C318.938 148.008 318.783 147.42 318.76 146.821C318.738 146.22 318.848 145.624 319.084 145.07C327.226 125.716 330.819 110.23 325.021 103.747C309.666 86.5471 248.085 120.749 228.451 132.333C227.925 132.642 227.337 132.837 226.728 132.903C226.118 132.969 225.501 132.906 224.918 132.719C224.336 132.531 223.801 132.223 223.351 131.815C222.902 131.407 222.548 130.909 222.313 130.356C214.06 111.043 205.384 97.6094 196.589 97.0268C173.279 95.4688 154.491 162.187 148.991 183.932C148.844 184.515 148.57 185.06 148.188 185.528C147.805 185.998 147.323 186.381 146.775 186.651C146.227 186.921 145.626 187.072 145.012 187.094C144.399 187.116 143.788 187.009 143.221 186.778C123.406 178.825 107.545 175.316 100.914 180.98C83.305 195.978 118.315 256.126 130.175 275.304C130.492 275.816 130.692 276.391 130.76 276.987C130.829 277.582 130.765 278.186 130.573 278.755C130.381 279.325 130.065 279.847 129.647 280.286C129.228 280.725 128.718 281.07 128.15 281.298C108.384 289.359 94.6306 297.834 94.0272 306.424C92.439 329.192 160.74 347.544 183.01 352.916C183.605 353.061 184.16 353.33 184.64 353.704C185.118 354.077 185.509 354.548 185.785 355.083C186.061 355.618 186.215 356.205 186.237 356.803C186.26 357.402 186.151 357.998 185.916 358.551C177.773 377.905 174.181 393.398 179.979 399.874C195.334 417.074 256.921 382.877 276.556 371.293C277.081 370.984 277.67 370.789 278.28 370.722C278.889 370.655 279.507 370.717 280.09 370.905C280.673 371.093 281.207 371.402 281.657 371.81C282.106 372.219 282.46 372.717 282.694 373.271C290.947 392.578 299.616 406.012 308.417 406.601C331.728 408.153 350.516 341.44 356.009 319.688C356.157 319.106 356.432 318.562 356.816 318.094C357.2 317.625 357.682 317.243 358.231 316.974C358.779 316.705 359.381 316.554 359.995 316.533C360.608 316.511 361.219 316.619 361.786 316.85C381.601 324.803 397.455 328.304 404.093 322.648C421.702 307.65 386.684 247.495 374.825 228.317C374.51 227.804 374.312 227.229 374.245 226.634C374.177 226.039 374.242 225.436 374.434 224.868C374.626 224.299 374.941 223.777 375.358 223.338C375.775 222.899 376.284 222.552 376.85 222.323C396.623 214.261 410.376 205.786 410.973 197.196C412.568 174.428 344.26 156.078 321.997 150.712ZM295.254 128.885C299.734 136.73 276.646 189 259.474 225.561C259.186 226.172 258.715 226.682 258.121 227.024C257.528 227.365 256.842 227.521 256.155 227.47C255.468 227.419 254.814 227.164 254.28 226.739C253.746 226.314 253.358 225.739 253.169 225.093C246.234 201.322 238.306 173.392 229.824 149.683C229.491 148.752 229.508 147.736 229.871 146.817C230.235 145.897 230.921 145.133 231.808 144.662C252.989 133.363 289.234 118.358 295.254 128.885ZM193.746 135.355C202.589 137.807 224.103 190.714 238.424 228.426C238.664 229.056 238.699 229.742 238.527 230.393C238.354 231.044 237.983 231.627 237.461 232.065C236.939 232.503 236.292 232.775 235.608 232.844C234.923 232.913 234.234 232.775 233.632 232.45C211.501 220.453 185.694 206.159 162.529 195.253C161.622 194.823 160.901 194.093 160.493 193.192C160.085 192.292 160.018 191.279 160.303 190.335C167.12 167.736 181.865 132.069 193.746 135.355ZM126.652 210.04C134.676 205.664 188.197 228.216 225.621 244.989C226.248 245.269 226.771 245.73 227.12 246.31C227.47 246.889 227.629 247.56 227.577 248.23C227.524 248.901 227.264 249.54 226.828 250.062C226.393 250.582 225.805 250.962 225.143 251.147C200.813 257.921 172.211 265.664 147.937 273.949C146.985 274.272 145.946 274.255 145.007 273.9C144.067 273.545 143.286 272.876 142.805 272.011C131.257 251.322 115.867 215.92 126.652 210.04ZM133.275 309.188C135.779 300.551 189.952 279.537 228.562 265.548C229.207 265.315 229.91 265.28 230.576 265.448C231.243 265.617 231.84 265.98 232.288 266.49C232.736 266.999 233.015 267.631 233.085 268.299C233.155 268.968 233.015 269.641 232.682 270.23C220.392 291.846 205.758 317.053 194.592 339.672C194.156 340.561 193.409 341.269 192.486 341.668C191.563 342.068 190.525 342.134 189.557 341.853C166.42 335.235 129.905 320.792 133.275 309.188ZM209.739 374.722C205.252 366.884 228.347 314.608 245.519 278.054C245.806 277.442 246.279 276.931 246.872 276.59C247.465 276.249 248.151 276.093 248.838 276.144C249.525 276.194 250.179 276.45 250.713 276.875C251.247 277.3 251.634 277.874 251.824 278.521C258.759 302.285 266.686 330.222 275.169 353.932C275.499 354.862 275.481 355.877 275.117 356.795C274.752 357.713 274.064 358.475 273.178 358.945C252.004 370.223 215.752 385.256 209.76 374.722H209.739ZM311.247 368.252C302.397 365.807 280.883 312.894 266.562 275.182C266.322 274.55 266.285 273.862 266.458 273.21C266.63 272.559 267.003 271.974 267.526 271.536C268.049 271.097 268.697 270.826 269.382 270.758C270.068 270.69 270.759 270.83 271.361 271.157C293.485 283.154 319.299 297.455 342.457 308.362C343.366 308.789 344.089 309.519 344.497 310.42C344.905 311.321 344.971 312.335 344.683 313.28C337.872 335.912 323.128 371.544 311.247 368.252ZM378.341 293.566C370.31 297.949 316.795 275.391 279.365 258.618C278.738 258.338 278.215 257.877 277.866 257.297C277.516 256.718 277.357 256.047 277.409 255.377C277.461 254.706 277.722 254.067 278.158 253.546C278.593 253.025 279.181 252.646 279.843 252.461C304.18 245.687 332.775 237.943 357.049 229.658C358.003 229.335 359.043 229.353 359.984 229.709C360.925 230.065 361.706 230.737 362.188 231.603C373.729 252.285 389.119 287.693 378.341 293.566ZM371.718 194.419C369.207 203.063 315.041 224.077 276.431 238.066C275.784 238.3 275.08 238.335 274.413 238.167C273.746 237.999 273.148 237.635 272.698 237.124C272.249 236.613 271.972 235.98 271.903 235.31C271.833 234.641 271.975 233.966 272.311 233.377C284.594 211.768 299.228 186.554 310.394 163.935C310.833 163.048 311.58 162.343 312.502 161.945C313.425 161.546 314.462 161.481 315.429 161.76C338.566 168.413 375.081 182.815 371.718 194.419Z"
              fill="#FAFAFA"
            />
          </svg>
        </IconBox>
      )
    case 'pi':
      return (
        <IconBox bg="#09090b">
          <img
            src="/images/integrations/pi.svg"
            alt={agent.name}
            className="size-full object-contain"
          />
        </IconBox>
      )
    case 'goose':
      return (
        <IconBox bg="#ffffff">
          <img
            src="/images/integrations/goose.svg"
            alt={agent.name}
            className="size-full object-contain"
          />
        </IconBox>
      )
    case 'openhands':
      return (
        <IconBox bg="#ffffff">
          <img
            src="/images/integrations/openhands.svg"
            alt={agent.name}
            className="size-full object-contain p-1"
          />
        </IconBox>
      )
    case 'kilo':
      return (
        <IconBox bg="#ffffff">
          <img
            src="/images/integrations/kilo.svg"
            alt={agent.name}
            className="size-full object-contain"
          />
        </IconBox>
      )
    case 'openclaw':
      return (
        <IconBox bg="#ffffff">
          <img
            src="/images/integrations/openclaw.png"
            alt={agent.name}
            className="size-full object-contain"
          />
        </IconBox>
      )
    case 'hermes':
      return (
        <IconBox bg="#ffffff">
          <img
            src="/images/integrations/hermes.png"
            alt={agent.name}
            className="size-full object-contain"
          />
        </IconBox>
      )
    case 'cline':
      return (
        <IconBox bg="#2b303b">
          <img
            src="/images/integrations/cline.png"
            alt={agent.name}
            className="size-full object-cover"
          />
        </IconBox>
      )
    default:
      return (
        <IconBox bg="#52525b">
          <span className="text-sm font-semibold text-white">
            {agent.name.charAt(0)}
          </span>
        </IconBox>
      )
  }
}

// Installs are indeterminate (npm / curl script) with no progress %, so the
// button cycles short status messages to make it clear work is ongoing.
const INSTALL_STEP_KEYS = [
  'launch:installSteps.installing',
  'launch:installSteps.downloading',
  'launch:installSteps.building',
  'launch:installSteps.settingUp',
] as const

function InstallingLabel() {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = setInterval(
      () => setStep((s) => (s + 1) % INSTALL_STEP_KEYS.length),
      4000
    )
    return () => clearInterval(id)
  }, [])
  // Fixed, compact width so the label + spinner fit inside the same-size
  // (Run-width) button and it never jumps as the text changes.
  // `key={step}` remounts the node on each change so the browser repaints it
  // cleanly — without it the previous frame's text was left as a stale-paint
  // rectangle next to the spinning (`animate-spin`) icon's compositing layer.
  return (
    <span
      key={step}
      className="pointer-events-none inline-block w-[68px] select-none truncate text-center text-xs leading-none"
    >
      {t(INSTALL_STEP_KEYS[step])}
    </span>
  )
}

function LaunchPage() {
  const { t } = useTranslation()
  const {
    serverHost,
    serverPort,
    setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
    proxyTimeout,
  } = useLocalApiServer()
  const { serverStatus, setServerStatus } = useAppState()
  const serviceHub = useServiceHub()

  // Transient install / run state lives in a module-level store so it survives
  // navigating away from and back to this page mid-install (the Rust installer
  // keeps running; we must keep showing its progress on return).
  const installed = useLaunchStore((s) => s.installed)
  const setInstalled = useLaunchStore((s) => s.setInstalled)
  const busy = useLaunchStore((s) => s.busy)
  const setBusy = useLaunchStore((s) => s.setBusy)
  const spinning = useLaunchStore((s) => s.spinning)
  const setSpinning = useLaunchStore((s) => s.setSpinning)
  const phase = useLaunchStore((s) => s.phase)
  const setPhase = useLaunchStore((s) => s.setPhase)
  const logs = useLaunchStore((s) => s.logs)
  const setLogs = useLaunchStore((s) => s.setLogs)
  const openLog = useLaunchStore((s) => s.openLog)
  const setOpenLog = useLaunchStore((s) => s.setOpenLog)
  const [runningModels, setRunningModels] = useState<string[]>([])

  const detect = useCallback(
    async (agent: IntegrationAgent): Promise<boolean> => {
      try {
        const ok = await invoke<boolean>('detect_agent_installed', {
          bin: agent.detectBin,
        })
        setInstalled((prev) => ({ ...prev, [agent.id]: ok }))
        return ok
      } catch {
        setInstalled((prev) => ({ ...prev, [agent.id]: false }))
        return false
      }
    },
    [setInstalled]
  )

  const refreshRunningModels = useCallback(async () => {
    try {
      const active = (await serviceHub.models().getActiveModels()) || []
      setRunningModels(active)
    } catch {
      setRunningModels([])
    }
  }, [serviceHub])

  useEffect(() => {
    INTEGRATION_AGENTS.forEach((agent) => detect(agent))
  }, [detect])

  useEffect(() => {
    refreshRunningModels()
  }, [refreshRunningModels, serverStatus])

  const activeModel = runningModels[0] ?? null

  const ensureServerRunning = useCallback(async () => {
    if (serverStatus === 'running') return
    try {
      const actualPort = await window.core?.api?.startServer({
        host: serverHost,
        port: serverPort,
        prefix: apiPrefix,
        apiKey,
        trustedHosts,
        isCorsEnabled: corsEnabled,
        isVerboseEnabled: verboseLogs,
        proxyTimeout,
      })
      if (actualPort && actualPort !== serverPort) setServerPort(actualPort)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('already running')) throw err
    }
    setServerStatus('running')
  }, [
    serverStatus,
    serverHost,
    serverPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
    proxyTimeout,
    setServerPort,
    setServerStatus,
  ])

  // Install the agent's binary, streaming its installer log. Returns whether
  // the install succeeded. Does NOT manage the shared busy/spinner state —
  // `handleRun` owns that so install + configure read as one action.
  const installAgent = useCallback(
    async (agent: IntegrationAgent): Promise<boolean> => {
      setLogs((prev) => ({ ...prev, [agent.id]: [] }))
      setOpenLog((prev) => ({ ...prev, [agent.id]: true }))

      let unlisten: UnlistenFn | undefined
      try {
        unlisten = await listen<string>(
          `agent_install_log:${agent.id}`,
          (event) => {
            setLogs((prev) => ({
              ...prev,
              [agent.id]: [...(prev[agent.id] ?? []), event.payload],
            }))
          }
        )
        await invoke('install_agent', { agentId: agent.id })
        toast.success(t('launch:toast.installSuccess', { name: agent.name }), {
          description: t('launch:toast.installSuccessDesc', {
            name: agent.name,
          }),
        })
        await detect(agent)
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(t('launch:toast.installFailed', { name: agent.name }), {
          description: msg,
        })
        return false
      } finally {
        unlisten?.()
      }
    },
    [detect, t, setLogs, setOpenLog]
  )

  // Write the agent's config so it points at the local server. Throws on
  // failure so the caller can surface a single error toast.
  const configureAgent = useCallback(
    async (agent: IntegrationAgent, model: string | null) => {
      if (serverStatus !== 'running') {
        toast.info(t('launch:toast.serverStarting'), {
          description: t('launch:toast.serverStartingDesc', {
            name: agent.name,
          }),
        })
        await ensureServerRunning()
      }

      // `serverHost` may be a bind-all address (0.0.0.0 / ::) which clients
      // cannot connect to; agents need a real loopback address.
      const connectHost =
        serverHost === '0.0.0.0' || (serverHost as string) === '::'
          ? '127.0.0.1'
          : serverHost
      const base = `http://${connectHost}:${serverPort}`
      const apiUrl = agent.endpointWithPrefix ? `${base}${apiPrefix}` : base
      const key = apiKey || undefined

      switch (agent.id) {
        case 'claude-code':
          await invoke('configure_claude_code', {
            apiUrl,
            model: model ?? undefined,
            apiKey: key,
          })
          break
        case 'codex':
          await invoke('configure_codex', { apiUrl, model, apiKey: key })
          break
        case 'opencode':
          await invoke('configure_opencode', { apiUrl, model, apiKey: key })
          break
        case 'cline':
          await invoke('configure_cline', { apiUrl, model, apiKey: key })
          break
        case 'mimo':
          await invoke('configure_mimo', { apiUrl, model, apiKey: key })
          break
        case 'copilot':
          await invoke('configure_copilot', { apiUrl, model, apiKey: key })
          break
        case 'droid':
          await invoke('configure_droid', { apiUrl, model, apiKey: key })
          break
        case 'hermes':
          await invoke('configure_hermes_agent', {
            apiUrl,
            model,
            apiKey: key,
            // Hermes Agent refuses to start below a 64K context window, so we
            // configure 64K (the minimum it accepts).
            contextLength: 65536,
          })
          break
        case 'pi':
          await invoke('configure_pi', { apiUrl, model, apiKey: key })
          break
        case 'goose':
          await invoke('configure_goose', { apiUrl, model, apiKey: key })
          break
        case 'openhands':
          await invoke('configure_openhands', { apiUrl, model, apiKey: key })
          break
        case 'kilo':
          await invoke('configure_kilo', { apiUrl, model, apiKey: key })
          break
        case 'openclaw':
          await invoke('configure_openclaw', { apiUrl, model, apiKey: key })
          break
        default:
          throw new Error(`Unknown agent: ${agent.id}`)
      }

      toast.success(t('launch:toast.configured', { name: agent.name }), {
        description: t('launch:toast.configuredDesc', { name: agent.name }),
        duration: 8000,
      })
    },
    [serverStatus, ensureServerRunning, serverHost, serverPort, apiPrefix, apiKey, t]
  )

  // Single entry point behind the unified button: install first if the agent
  // isn't present yet, then configure it to use the running model.
  const handleRun = useCallback(
    async (agent: IntegrationAgent) => {
      const model = activeModel
      if (agent.requiresModel && !model) {
        toast.error(t('launch:noRunningModelToast', { name: agent.name }))
        return
      }

      posthog.capture('agent_run', {
        agent_id: agent.id,
        agent_name: agent.name,
        agent_kind: agent.kind,
      })

      setBusy((prev) => ({ ...prev, [agent.id]: true }))
      const spinTimer = setTimeout(
        () => setSpinning((prev) => ({ ...prev, [agent.id]: true })),
        SPINNER_DELAY_MS
      )
      try {
        let present = installed[agent.id]
        if (present === undefined) present = await detect(agent)

        if (agent.installable && !present) {
          setPhase((prev) => ({ ...prev, [agent.id]: 'installing' }))
          const ok = await installAgent(agent)
          if (!ok) return
        }

        setPhase((prev) => ({ ...prev, [agent.id]: 'configuring' }))
        await configureAgent(agent, model)

        // Config is written; open a terminal running the agent so the user can
        // start immediately. A terminal failure must not fail the whole Run.
        try {
          // OpenClaw's bare `openclaw` entry is the Crestodian setup/repair
          // helper (deterministic commands), not a chat. `openclaw chat` runs
          // the embedded local agent runtime, so the user lands straight in a
          // conversation with the configured model (no gateway needed).
          // Goose's bare `goose` only prints help; `goose session` starts an
          // interactive chat. OpenHands reads our env overrides only when
          // launched with `--override-with-envs`. Everything else runs its
          // bare detect binary.
          let command: string
          if (agent.id === 'openclaw') {
            command = 'openclaw chat'
          } else if (agent.id === 'goose') {
            command = 'goose session'
          } else if (agent.id === 'openhands') {
            command = 'openhands --override-with-envs'
          } else {
            command = agent.detectBin
          }
          await invoke('open_agent_terminal', { command })
        } catch (termErr) {
          const tmsg =
            termErr instanceof Error ? termErr.message : String(termErr)
          toast.warning(t('launch:toast.terminalFailed', { name: agent.name }), {
            description: tmsg,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(t('launch:toast.configureFailed', { name: agent.name }), {
          description: msg,
        })
      } finally {
        clearTimeout(spinTimer)
        setBusy((prev) => ({ ...prev, [agent.id]: false }))
        setSpinning((prev) => ({ ...prev, [agent.id]: false }))
        setPhase((prev) => ({ ...prev, [agent.id]: undefined }))
      }
    },
    [
      activeModel,
      installed,
      detect,
      installAgent,
      configureAgent,
      t,
      setBusy,
      setSpinning,
      setPhase,
    ]
  )

  const coding = INTEGRATION_AGENTS.filter((a) => a.kind === 'coding')
  const assistants = INTEGRATION_AGENTS.filter((a) => a.kind === 'assistant')

  const renderAgent = (agent: IntegrationAgent) => {
    const isInstalled = installed[agent.id]
    const isBusy = busy[agent.id]
    const isSpinning = spinning[agent.id]
    const runPhase = phase[agent.id]
    const agentLogs = logs[agent.id] ?? []

    return (
      <Card key={agent.id} className="bg-card rounded-lg">
        <div className="flex items-center gap-3">
          <AgentIcon agent={agent} />
          <h2 className="font-studio truncate text-base font-medium text-foreground">
            {agent.name}
          </h2>
          {isInstalled !== undefined && (
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                isInstalled
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {isInstalled ? t('launch:installed') : t('launch:notInstalled')}
            </span>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openUrl(agent.docsUrl)}
            >
              <IconExternalLink size={14} className="text-muted-foreground" />
              {t('launch:docs')}
            </Button>
            {agent.configurable && (
              <Button
                size="sm"
                className="w-[112px] transform-gpu justify-center gap-1.5 select-none"
                onClick={() => handleRun(agent)}
                disabled={isBusy}
              >
                {runPhase === 'installing' ? (
                  <>
                    <IconLoader2
                      size={14}
                      className="pointer-events-none animate-spin"
                    />
                    <InstallingLabel />
                  </>
                ) : (
                  <>
                    {runPhase === 'configuring' && isSpinning && (
                      <IconLoader2 size={14} className="animate-spin" />
                    )}
                    {t('launch:enable')}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-sm leading-normal text-muted-foreground">
          {agent.description}
        </p>

        {agentLogs.length > 0 && (
          <div className="mt-3">
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() =>
                setOpenLog((prev) => ({
                  ...prev,
                  [agent.id]: !prev[agent.id],
                }))
              }
            >
              <IconTerminal2 size={14} />
              {t('launch:installLog')}
              <IconChevronDown
                size={14}
                className={cn(
                  'transition-transform',
                  openLog[agent.id] && 'rotate-180'
                )}
              />
            </button>
            {openLog[agent.id] && (
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-secondary/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
                {agentLogs.join('\n')}
              </pre>
            )}
          </div>
        )}
      </Card>
    )
  }

  return (
    <div className="flex h-svh w-full flex-col">
      <HeaderPage />
      <div className="h-[calc(100%-60px)] overflow-y-auto p-4 pt-0">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div>
              <h1 className="font-studio text-lg font-medium text-foreground">
                {t('launch:serverSection')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('launch:serverSectionDesc')}
              </p>
            </div>
            <LocalApiServerPanel />
          </section>

          {assistants.length > 0 && (
            <section className="flex flex-col gap-3">
              <div>
                <h1 className="font-studio text-lg font-medium text-foreground">
                  {t('launch:assistants')}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t('launch:assistantsDesc')}
                </p>
              </div>
              {assistants.map(renderAgent)}
            </section>
          )}

          <section className="flex flex-col gap-3">
            <div>
              <h1 className="font-studio text-lg font-medium text-foreground">
                {t('launch:codingAgents')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('launch:codingAgentsDesc')}
              </p>
            </div>
            {coding.map(renderAgent)}
          </section>
        </div>
      </div>
    </div>
  )
}
