import HeaderTitle from '../HeaderTitle'
import DownloadedModelTable from '../DownloadedModelTable'
import ActiveModelTable from '../ActiveModelTable'
import DownloadingModelTable from '../DownloadingModelTable'

const MyModelContainer: React.FC = () => (
  <div className="flex flex-1 flex-col pt-[60px]">
    <HeaderTitle title="My Models" className="pl-[63px] pr-[89px]" />
    <div className="scroll overflow-y-auto pb-6">
      <ActiveModelTable />
      <DownloadingModelTable />
      <DownloadedModelTable />
    </div>
  </div>
)

export default MyModelContainer
