import BasicPromptInput from "../BasicPromptInput";
import BasicPromptAccessories from "../BasicPromptAccessories";

const InputToolbar: React.FC = () => {
  return (
    <div className="mx-3 mb-3 flex-none overflow-hidden shadow-sm ring-1 ring-inset ring-gray-300 rounded-lg dark:bg-gray-800">
      <BasicPromptInput />
      <BasicPromptAccessories />
    </div>
  );
};

export default InputToolbar;
