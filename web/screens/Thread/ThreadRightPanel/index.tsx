import { Tabs, TabsContent } from '@janhq/joi'

import { useAtom, useAtomValue } from 'jotai'

import ModelDropdown from '@/containers/ModelDropdown'

import RightPanelContainer from '@/containers/RightPanelContainer'

import AssistantSettingContainer from './AssistantSettingContainer'
import ModelSettingContainer from './ModelSettingContainer'

import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

import { activeTabThreadRightPanelAtom } from '@/helpers/atoms/ThreadRightPanel.atom'

const ThreadRightPanel: React.FC = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const [activeTabThreadRightPanel, setActiveTabThreadRightPanel] = useAtom(
    activeTabThreadRightPanelAtom
  )

  if (!activeThread) return null

  return (
    <RightPanelContainer>
      <Tabs
        options={[
          { name: 'Assistant', value: 'assistant' },
          { name: 'Model', value: 'model' },
          // ...(experimentalFeature ? [{ name: 'Tools', value: 'tools' }] : []),
        ]}
        value={activeTabThreadRightPanel}
        onValueChange={(value) => setActiveTabThreadRightPanel(value)}
      >
        <TabsContent value="assistant">
          <AssistantSettingContainer />
        </TabsContent>
        <TabsContent value="model">
          <div className="flex flex-col gap-4 px-2 py-4">
            <ModelDropdown />
          </div>
          <ModelSettingContainer />
        </TabsContent>
        {/* <TabsContent value="tools">
          <Tools />
        </TabsContent> */}
      </Tabs>
    </RightPanelContainer>
  )
}

export default ThreadRightPanel
