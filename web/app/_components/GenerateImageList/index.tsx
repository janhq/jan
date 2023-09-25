import { Product } from "@/_models/Product";
import GenerateImageCard from "../GenerateImageCard";
import { PhotoIcon } from "@heroicons/react/24/outline";

type Props = {
  products: Product[];
};

const GenerateImageList: React.FC<Props> = ({ products }) => (
  <>
    {products.length === 0 ? null : (
      <div className="flex items-center gap-3 mt-8 mb-2">
        <PhotoIcon width={24} height={24} className="ml-6" />
        <span className="font-semibold text-gray-900 dark:text-white">
          Generate Images
        </span>
      </div>
    )}
    <div className="mt-2 mx-6 mb-6 grid grid-cols-2 gap-6 sm:gap-x-6 md:grid-cols-4 md:gap-8">
      {products.map((item) => (
        <GenerateImageCard key={item.name} product={item} />
      ))}
    </div>
  </>
);

export default GenerateImageList;
