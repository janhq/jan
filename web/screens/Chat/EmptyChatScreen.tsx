import React from 'react'
import SelectModels from '@/_components/ModelSelector'
import InputToolbar from '@/_components/InputToolbar'
import HistoryList from '@/_components/HistoryList'

const EmptyChatScreen: React.FC = () => (
  <div className="flex h-full">
    <div className="border-gray-20 border-border flex h-full w-80 flex-shrink-0 flex-col overflow-y-auto border-r">
      <div className="p-6">
        <HistoryList />
      </div>
    </div>
    <div className="bg-background/50 relative w-full overflow-y-auto p-5">
      <div className="flex flex-1 items-center justify-center">
        <SelectModels />
      </div>
      <InputToolbar />
    </div>
  </div>
)

export default EmptyChatScreen
