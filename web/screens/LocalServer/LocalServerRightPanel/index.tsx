import { useCallback, useEffect, useMemo, useState } from 'react'

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

import {
  extractRuntimeParams,
  extractModelLoadParams,
} from '@/utils/modelParam'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'

const LocalServerRightPanel = () => {
  const loadModelError = useAtomValue(loadModelErrorAtom)
  const serverEnabled = useAtomValue(serverEnabledAtom)
  const setModalTroubleShooting = useSetAtom(modalTroubleShootingAtom)

  const selectedModel = useAtomValue(selectedModelAtom)

  const [currentModelSettingParams, setCurrentModelSettingParams] = useState(
    extractModelLoadParams(selectedModel?.settings)
  )

  useEffect(() => {
    if (selectedModel) {
      setCurrentModelSettingParams(
        extractModelLoadParams(selectedModel?.settings)
      )
    }
  }, [selectedModel])

  const modelRuntimeParams = extractRuntimeParams(selectedModel?.settings)

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

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean) => {
      setCurrentModelSettingParams({
        ...currentModelSettingParams,
        [key]: value,
      })
    },
    [currentModelSettingParams]
  )

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
