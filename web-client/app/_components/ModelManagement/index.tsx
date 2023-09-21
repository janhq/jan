import HeaderBackButton from "../HeaderBackButton";
import HeaderTitle from "../HeaderTitle";
import ModelListContainer from "../ModelListContainer";
import ModelSearchBar from "../ModelSearchBar";

export default function ModelManagement() {
  return (
    <main className="pt-[30px] pr-[89px] pl-[60px] pb-[70px] flex-1">
      <HeaderBackButton />
      <HeaderTitle title="Explore Models" />
      <ModelSearchBar />
      <ModelListContainer />
    </main>
  );
}
