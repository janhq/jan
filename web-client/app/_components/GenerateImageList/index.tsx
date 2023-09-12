import { Product } from "@/_models/Product";
import GenerateImageCard from "../GenerateImageCard";
import { PhotoIcon } from "@heroicons/react/24/outline";

type Props = {
  products: Product[];
};

const GenerateImageList: React.FC<Props> = ({ products }) => (
  <>
    <div className="flex mt-4 mx-6 justify-between">
      <div className="gap-4 flex items-center">
        <PhotoIcon width={24} height={24} />
        <h2 className="text-gray-900 font-bold dark:text-white">
          Generate Images
        </h2>
      </div>
    </div>
    <div className="mt-2 mx-6 mb-6 grid grid-cols-2 gap-6 sm:gap-x-6 md:grid-cols-4 md:gap-8">
      {products.map((item) => (
        <GenerateImageCard key={item.name} product={item} />
      ))}
    </div>
  </>
);

export default GenerateImageList;
