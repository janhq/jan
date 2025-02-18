import { useCallback, useEffect, useMemo, useState } from 'react'

import { extractInferenceParams, extractModelLoadParams } from '@janhq/core'
import { Accordion, AccordionItem, Input } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertTriangleIcon, CheckIcon, CopyIcon, InfoIcon } from 'lucide-react'

import EngineSetting from '@/containers/EngineSetting'
import { modalTroubleShootingAtom } from '@/containers/ModalTroubleShoot'
import ModelDropdown from '@/containers/ModelDropdown'
import ModelSetting from '@/containers/ModelSetting'
import RightPanelContainer from '@/containers/RightPanelContainer'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import { useClipboard } from '@/hooks/useClipboard'

import { getConfigurationsData } from '@/utils/componentSettings'

import {
  LocalAPIserverModelParamsAtom,
  serverEnabledAtom,
} from '@/helpers/atoms/LocalServer.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'

const LocalServerRightPanel = () => {
  const loadModelError = useAtomValue(loadModelErrorAtom)
  const setLocalAPIserverModelParams = useSetAtom(LocalAPIserverModelParamsAtom)
  const serverEnabled = useAtomValue(serverEnabledAtom)
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)

  const selectedModel = useAtomValue(selectedModelAtom)

  const clipboard = useClipboard({ timeout: 1000 })

  const [currentModelSettingParams, setCurrentModelSettingParams] = useState(
    extractModelLoadParams(selectedModel?.settings)
  )

  const overriddenSettings =
    selectedModel?.settings.ctx_len && selectedModel.settings.ctx_len > 2048
      ? { ctx_len: 4096 }
      : {}

  useEffect(() => {
    if (selectedModel) {
      setCurrentModelSettingParams({
        ...selectedModel?.settings,
        ...overriddenSettings,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel])

  const modelRuntimeParams = extractInferenceParams(selectedModel?.settings)

  const componentDataRuntimeSetting = getConfigurationsData(
    modelRuntimeParams,
    selectedModel
  )

  const componentDataEngineSetting = getConfigurationsData(
    currentModelSettingParams
  )

  const engineSettings = useMemo(
    () =>
      componentDataEngineSetting.filter(
        (x) => x.key !== 'prompt_template' && x.key !== 'embedding'
      ),

    [componentDataEngineSetting]
  )

  const modelSettings = useMemo(() => {
    return componentDataRuntimeSetting.filter(
      (x) => x.key !== 'prompt_template'
    )
  }, [componentDataRuntimeSetting])

  const onUpdateParams = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setLocalAPIserverModelParams(() => {
      return { ...currentModelSettingParams }
    })
  }, [currentModelSettingParams, setLocalAPIserverModelParams])

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean | string[]) => {
      setCurrentModelSettingParams((prevParams) => ({
        ...prevParams,
        [key]: value,
      }))
    },
    []
  )

  useEffect(() => {
    onUpdateParams()
  }, [currentModelSettingParams, onUpdateParams])

  return (
    <RightPanelContainer>
      <div className="mb-4 px-4 pt-4">
        <div className="mb-4 flex items-start space-x-2">
          <InfoIcon
            size={16}
            className="mt-1 flex-shrink-0 text-[hsla(var(--text-secondary))]"
          />
          <p>
            You can concurrently send requests to one active local model and
            multiple remote models.
          </p>
        </div>

        <ModelDropdown strictedThread={false} disabled={serverEnabled} />

        <div className="mt-2">
          <Input
            value={selectedModel?.id || ''}
            className="cursor-pointer text-[hsla(var(--text-secondary))] hover:border-[hsla(var(--app-border))] focus-visible:outline-0 focus-visible:ring-0"
            readOnly
            onClick={() => {
              clipboard.copy(selectedModel?.id)
            }}
            suffixIcon={
              selectedModel ? (
                clipboard.copied ? (
                  <CheckIcon
                    size={14}
                    className="text-[hsla(var(--success-bg))]"
                  />
                ) : (
                  <CopyIcon
                    size={14}
                    className="cursor-pointer text-[hsla(var(--text-secondary))]"
                  />
                )
              ) : (
                <></>
              )
            }
          />
        </div>

        {loadModelError && serverEnabled && (
          <div className="mt-3 flex space-x-2">
            <AlertTriangleIcon
              size={14}
              className="flex-shrink-0 text-[hsla(var(--destructive-bg))]"
            />
            <span>
              Model failed to start. Access{' '}
              <span
                className="cursor-pointer"
                onClick={() => setModalTroubleShooting(true)}
              >
                troubleshooting assistance
              </span>
            </span>
          </div>
        )}
      </div>

      <Accordion defaultValue={[]}>
        {modelSettings.length !== 0 && (
          <AccordionItem
            title="Inference Parameters"
            value="Inference Parameters"
          >
            <ModelSetting
              componentProps={modelSettings}
              onValueChanged={onValueChanged}
              disabled={serverEnabled}
            />
          </AccordionItem>
        )}

        {engineSettings.length !== 0 && (
          <AccordionItem title="Engine Parameters" value="Engine Parameters">
            <EngineSetting
              componentData={engineSettings}
              onValueChanged={onValueChanged}
              disabled={serverEnabled}
            />
          </AccordionItem>
        )}
      </Accordion>
    </RightPanelContainer>
  )
}

export default LocalServerRightPanel
