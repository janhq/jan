import { Fragment, useCallback, useEffect } from 'react'

import { Button } from '@janhq/joi'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightOpenIcon,
  PanelRightCloseIcon,
  MinusIcon,
  MenuIcon,
  SquareIcon,
  PaletteIcon,
  XIcon,
  PenSquareIcon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { toaster } from '@/containers/Toast'

import useAssistantQuery from '@/hooks/useAssistantQuery'
import useThreadCreateMutation from '@/hooks/useThreadCreateMutation'
import useThreads from '@/hooks/useThreads'

import { copyOverInstructionEnabledAtom } from '@/screens/Thread/ThreadRightPanel/AssistantSettingContainer/components/CopyOverInstruction'

import {
  MainViewState,
  mainViewStateAtom,
  showLeftPanelAtom,
  showRightPanelAtom,
} from '@/helpers/atoms/App.atom'
import {
  downloadedModelsAtom,
  getSelectedModelAtom,
} from '@/helpers/atoms/Model.atom'
import {
  reduceTransparentAtom,
  selectedSettingAtom,
} from '@/helpers/atoms/Setting.atom'
import { threadsAtom, activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const TopPanel = () => {
  const [showLeftPanel, setShowLeftPanel] = useAtom(showLeftPanelAtom)
  const [showRightPanel, setShowRightPanel] = useAtom(showRightPanelAtom)
  const [mainViewState, setMainViewState] = useAtom(mainViewStateAtom)
  const setSelectedSetting = useSetAtom(selectedSettingAtom)
  const reduceTransparent = useAtomValue(reduceTransparentAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)

  const { setActiveThread } = useThreads()
  const createThreadMutation = useThreadCreateMutation()

  const selectedModel = useAtomValue(getSelectedModelAtom)
  const threads = useAtomValue(threadsAtom)

  const activeThread = useAtomValue(activeThreadAtom)
  const { data: assistants } = useAssistantQuery()
  const copyOverInstructionEnabled = useAtomValue(
    copyOverInstructionEnabledAtom
  )

  useEffect(() => {
    if (activeThread?.id) return
    if (threads.length === 0) return
    setActiveThread(threads[0].id)
  }, [activeThread?.id, setActiveThread, threads])

  const onCreateThreadClicked = useCallback(async () => {
    if (!assistants || !assistants.length) {
      toaster({
        title: 'No assistant available.',
        description: `Could not create a new thread. Please add an assistant.`,
        type: 'error',
      })
      return
    }
    if (!selectedModel) return
    let instructions: string | undefined = undefined
    if (copyOverInstructionEnabled) {
      instructions = activeThread?.assistants[0]?.instructions ?? undefined
    }
    await createThreadMutation.mutateAsync({
      modelId: selectedModel.model,
      assistant: assistants[0],
      instructions,
    })
  }, [
    createThreadMutation,
    selectedModel,
    assistants,
    activeThread,
    copyOverInstructionEnabled,
  ])

  return (
    <div
      className={twMerge(
        'fixed z-50 flex h-9 w-full items-center px-4',
        isMac && 'border-t-0 pl-20',
        reduceTransparent &&
          'border-b border-[hsla(var(--app-border))] bg-[hsla(var(--top-panel-bg))]'
      )}
    >
      {!isMac && <LogoMark width={24} height={24} className="-ml-1 mr-2" />}
      <div className="flex w-full items-center justify-between text-[hsla(var(--text-secondary))]">
        <div className="unset-drag flex cursor-pointer gap-x-0.5">
          {!isMac && (
            <Button
              theme="icon"
              onClick={() => {
                window?.electronAPI?.showOpenMenu(100, 100)
              }}
            >
              <MenuIcon size={16} />
            </Button>
          )}
          {mainViewState !== MainViewState.Hub &&
            downloadedModels.length > 0 && (
              <Fragment>
                {showLeftPanel ? (
                  <Button theme="icon" onClick={() => setShowLeftPanel(false)}>
                    <PanelLeftCloseIcon size={16} />
                  </Button>
                ) : (
                  <Button theme="icon" onClick={() => setShowLeftPanel(true)}>
                    <PanelLeftOpenIcon size={16} />
                  </Button>
                )}
              </Fragment>
            )}
          {mainViewState === MainViewState.Thread && (
            <Button
              data-testid="btn-create-thread"
              onClick={onCreateThreadClicked}
              theme="icon"
            >
              <PenSquareIcon
                size={16}
                className="cursor-pointer text-[hsla(var(--text-secondary))]"
              />
            </Button>
          )}
        </div>
        <div className="unset-drag flex items-center gap-x-2">
          {mainViewState !== MainViewState.Hub &&
            mainViewState !== MainViewState.Settings &&
            downloadedModels.length > 0 && (
              <Fragment>
                {showRightPanel ? (
                  <Button theme="icon" onClick={() => setShowRightPanel(false)}>
                    <PanelRightCloseIcon size={16} />
                  </Button>
                ) : (
                  <Button theme="icon" onClick={() => setShowRightPanel(true)}>
                    <PanelRightOpenIcon size={16} />
                  </Button>
                )}
              </Fragment>
            )}
          <Button
            theme="icon"
            onClick={() => {
              setMainViewState(MainViewState.Settings)
              setSelectedSetting('Appearance')
            }}
          >
            <PaletteIcon size={16} className="cursor-pointer" />
          </Button>

          {!isMac && (
            <div className="flex items-center gap-x-2">
              <Button
                theme="icon"
                onClick={() => window?.electronAPI?.setMinimizeApp()}
              >
                <MinusIcon size={16} />
              </Button>
              <Button
                theme="icon"
                onClick={() => window?.electronAPI?.setMaximizeApp()}
              >
                <SquareIcon size={14} />
              </Button>
              <Button
                theme="icon"
                onClick={() => window?.electronAPI?.setCloseApp()}
              >
                <XIcon size={16} />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export default TopPanel
