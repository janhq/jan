import HeaderTitle from "../HeaderTitle";
import SearchBar, { SearchType } from "../SearchBar";
import ExploreModelList from "../ExploreModelList";
import ExploreModelFilter from "../ExploreModelFilter";

const ExploreModelContainer: React.FC = () => (
  <div className="flex flex-col flex-1 px-16 pt-14 overflow-hidden">
    <HeaderTitle title="Explore Models" />
    <SearchBar
      type={SearchType.Model}
      placeholder="Owner name like TheBloke, etc.."
    />
    <div className="flex flex-1 gap-x-10 mt-9 overflow-hidden">
      <ExploreModelFilter />
      <ExploreModelList />
    </div>
  </div>
);

export default ExploreModelContainer;
