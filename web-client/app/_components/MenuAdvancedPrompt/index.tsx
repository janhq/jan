import AdvancedPromptText from "../AdvancedPromptText";
import AdvancedPromptImageUpload from "../AdvancedPromptImageUpload";
import AdvancedPromptResolution from "../AdvancedPromptResolution";
import AdvancedPromptGenerationParams from "../AdvancedPromptGenerationParams";
import { FieldValues, UseFormRegister } from "react-hook-form";

type Props = {
  register: UseFormRegister<FieldValues>;
};

export const MenuAdvancedPrompt: React.FC<Props> = ({ register }) => (
  <div className="flex flex-col flex-1 p-3 gap-[10px] overflow-x-hidden scroll">
    <AdvancedPromptText register={register} />
    <hr className="my-5" />
    <AdvancedPromptImageUpload register={register} />
    <hr className="my-5" />
    <AdvancedPromptResolution />
    <hr className="my-5" />
    <AdvancedPromptGenerationParams />
  </div>
);
