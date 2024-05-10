import { useCallback, useMemo, useState } from 'react'

import { Accordion, AccordionItem } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertTriangleIcon, InfoIcon } from 'lucide-react'

import EngineSetting from '@/containers/EngineSetting'
import { modalTroubleShootingAtom } from '@/containers/ModalTroubleShoot'
import ModelDropdown from '@/containers/ModelDropdown'
import ModelSetting from '@/containers/ModelSetting'
import RightPanelContainer from '@/containers/RightPanelContainer'

import { loadModelErrorAtom } from '@/hooks/useActiveModel'

import { getConfigurationsData } from '@/utils/componentSettings'

import { toRuntimeParams, toSettingParams } from '@/utils/modelParam'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import { getActiveThreadModelParamsAtom } from '@/helpers/atoms/Thread.atom'

const LocalServerRightPanel = () => {
  const loadModelError = useAtomValue(loadModelErrorAtom)
  const serverEnabled = useAtomValue(serverEnabledAtom)
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)

  const selectedModel = useAtomValue(selectedModelAtom)
  const modelRuntimeParams = toRuntimeParams(selectedModel?.settings)

  const [currentModelSettingParams, setCurrentModelSettingParams] = useState(
    toSettingParams(selectedModel?.settings)
  )

  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)

  const modelEngineParams = toSettingParams(activeModelParams)

  const modelSettings = useMemo(() => {
    const componentDataRuntimeSetting = getConfigurationsData(
      modelRuntimeParams,
      selectedModel
    )

    return componentDataRuntimeSetting.filter(
      (x) => x.key !== 'prompt_template'
    )
  }, [modelRuntimeParams, selectedModel])

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean) => {
      setCurrentModelSettingParams({
        ...currentModelSettingParams,
        [key]: value,
      })
    },
    [currentModelSettingParams]
  )

  const engineSettings = useMemo(() => {
    const componentDataEngineSetting = getConfigurationsData(
      modelEngineParams,
      selectedModel
    )
    return componentDataEngineSetting.filter(
      (x) => x.key !== 'prompt_template' && x.key !== 'embedding'
    )
  }, [modelEngineParams, selectedModel])

  return (
    <RightPanelContainer>
      <div className="mb-4 px-4 pt-4">
        <div className="mb-4 flex items-start space-x-2">
          <InfoIcon
            size={16}
            className="mt-1 flex-shrink-0 text-[hsla(var(--info-bg))]"
          />
          <p>
            You can concurrently send requests to one active local model and
            multiple remote models.
          </p>
        </div>

        <ModelDropdown strictedThread={false} />

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
            />
          </AccordionItem>
        )}

        {engineSettings.length !== 0 && (
          <AccordionItem title="Engine Parameters" value="Engine Parameters">
            <EngineSetting
              componentData={engineSettings}
              onValueChanged={onValueChanged}
            />
          </AccordionItem>
        )}
      </Accordion>
    </RightPanelContainer>
  )
}

export default LocalServerRightPanel
