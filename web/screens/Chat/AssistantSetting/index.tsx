import { useAtomValue } from 'jotai'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import SettingComponentBuilder, {
  SettingComponentData,
} from '../ModelSetting/SettingComponent'

import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const AssistantSetting = ({
  componentData,
}: {
  componentData: SettingComponentData[]
}) => {
  const activeThread = useAtomValue(activeThreadAtom)
  const { updateThreadMetadata } = useCreateNewThread()

  return (
    <div className="flex flex-col">
      {activeThread && componentData && (
        <SettingComponentBuilder
          componentData={componentData}
          updater={(_, name, value) => {
            if (
              activeThread.assistants[0].tools &&
              (name === 'chunk_overlap' || name === 'chunk_size')
            ) {
              if (
                activeThread.assistants[0].tools[0]?.settings.chunk_size <
                activeThread.assistants[0].tools[0]?.settings.chunk_overlap
              ) {
                activeThread.assistants[0].tools[0].settings.chunk_overlap =
                  activeThread.assistants[0].tools[0].settings.chunk_size
              }

              if (
                name === 'chunk_size' &&
                value <
                  activeThread.assistants[0].tools[0].settings.chunk_overlap
              ) {
                activeThread.assistants[0].tools[0].settings.chunk_overlap =
                  value
              } else if (
                name === 'chunk_overlap' &&
                value > activeThread.assistants[0].tools[0].settings.chunk_size
              ) {
                activeThread.assistants[0].tools[0].settings.chunk_size = value
              }
            }

            updateThreadMetadata({
              ...activeThread,
              assistants: [
                {
                  ...activeThread.assistants[0],
                  tools: [
                    {
                      type: 'retrieval',
                      enabled: true,
                      settings: {
                        ...(activeThread.assistants[0].tools &&
                          activeThread.assistants[0].tools[0]?.settings),
                        [name]: value,
                      },
                    },
                  ],
                },
              ],
            })
          }}
        />
      )}
    </div>
  )
}

export default AssistantSetting
