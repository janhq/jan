import { Button } from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import useGpuSetting from '@/hooks/useGpuSetting'

import { formatExtensionsName } from '@/utils/converter'

import { extensionManager } from '@/extension'
import Extension from '@/extension/Extension'
import { ignoreSslAtom, proxyAtom } from '@/helpers/atoms/AppConfig.atom'

type Props = {
  item: Extension
}

const TensorRtExtensionItem: React.FC<Props> = ({ item }) => {
  const { getGpuSettings } = useGpuSetting()
  const proxy = useAtomValue(proxyAtom)
  const ignoreSSL = useAtomValue(ignoreSslAtom)

  const onInstallClick = async () => {
    // TODO: NamH remove this
    // @ts-ignore
    const result = extensionManager.get('@janhq/tensorrt-llm-extension')
    // console.log(result)
    if (result) {
      // @ts-ignore
      const gpuSettings = await getGpuSettings()
      // @ts-ignore
      result.downloadRunner(gpuSettings, { proxy, ignoreSSL })
    }
  }

  return (
    <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-4 last:border-none">
      <div className="flex-1 flex-shrink-0 space-y-1.5">
        <div className="flex gap-x-2">
          <h6 className="text-sm font-semibold capitalize">
            {formatExtensionsName(item.name ?? item.description ?? '')}
          </h6>
          <p className="whitespace-pre-wrap font-semibold leading-relaxed ">
            v{item.version}
          </p>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed ">
          {item.description}
        </p>
      </div>

      <Button themes="secondaryBlue" size="sm" onClick={onInstallClick}>
        Install
      </Button>
    </div>
  )
}

export default TensorRtExtensionItem
