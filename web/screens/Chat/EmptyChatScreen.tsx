import HistoryList from '@/components/HistoryList'
import InputToolbar from '@/components/InputToolbar'
import SelectModels from '@/components/ModelSelector'

const EmptyChatScreen: React.FC = () => (
  <div className="flex h-full">
    <div className="border-gray-20 flex h-full w-80 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
      <div className="p-6">
        <HistoryList />
      </div>
    </div>
    <div className="relative w-full overflow-y-auto bg-background/50 p-5">
      <div className="flex flex-1 items-center justify-center">
        <SelectModels />
      </div>
      <InputToolbar />
    </div>
  </div>
)

export default EmptyChatScreen
