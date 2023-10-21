import React from 'react'
import SelectModels from '@/_components/ModelSelector'
import InputToolbar from '@/_components/InputToolbar'

const EmptyChatScreen: React.FC = () => (
  <div className="flex flex-1 flex-col">
    <div className="flex flex-1 items-center justify-center">
      <SelectModels />
    </div>
    <InputToolbar />
  </div>
)

export default EmptyChatScreen
