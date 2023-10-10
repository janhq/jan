import { Fragment, useEffect } from "react";
import { Listbox, Transition } from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/20/solid";
import { useAtom, useAtomValue } from "jotai";
import { selectedModelAtom } from "@/_helpers/atoms/Model.atom";
import { downloadedModelAtom } from "@/_helpers/atoms/DownloadedModel.atom";
import { AssistantModel } from "@/_models/AssistantModel";

function classNames(...classes: any) {
  return classes.filter(Boolean).join(" ");
}

const SelectModels: React.FC = () => {
  const downloadedModels = useAtomValue(downloadedModelAtom);
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom);

  useEffect(() => {
    if (downloadedModels && downloadedModels.length > 0) {
      onModelSelected(downloadedModels[0]);
    }
  }, [downloadedModels]);

  const onModelSelected = (model: AssistantModel) => {
    setSelectedModel(model);
  };

  if (!selectedModel) {
    return <div>You have not downloaded any model!</div>;
  }

  return (
    <Listbox value={selectedModel} onChange={onModelSelected}>
      {({ open }) => (
        <div className="w-[461px]">
          <Listbox.Label className="block text-sm font-medium leading-6 text-gray-900">
            Select a Model:
          </Listbox.Label>
          <div className="relative mt-[19px]">
            <Listbox.Button className="relative w-full cursor-default rounded-md bg-white py-1.5 pl-3 pr-10 text-left text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm sm:leading-6">
              <span className="flex items-center">
                <img
                  src={selectedModel.avatarUrl}
                  alt=""
                  className="h-5 w-5 flex-shrink-0 rounded-full"
                />
                <span className="ml-3 block truncate">
                  {selectedModel.name}
                </span>
              </span>
              <span className="pointer-events-none absolute inset-y-0 right-0 ml-3 flex items-center pr-2">
                <ChevronUpDownIcon
                  className="h-5 w-5 text-gray-400"
                  aria-hidden="true"
                />
              </span>
            </Listbox.Button>

            <Transition
              show={open}
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Listbox.Options className="absolute z-10 mt-1 max-h-[188px] w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                {downloadedModels.map((model) => (
                  <Listbox.Option
                    key={model.id}
                    className={({ active }) =>
                      classNames(
                        active ? "bg-blue-600 text-white" : "text-gray-900",
                        "relative cursor-default select-none py-2 pl-3 pr-9",
                      )
                    }
                    value={model}
                  >
                    {({ selected, active }) => (
                      <>
                        <div className="flex items-center">
                          <img
                            src={model.avatarUrl}
                            alt=""
                            className="h-5 w-5 flex-shrink-0 rounded-full"
                          />
                          <span
                            className={classNames(
                              selected ? "font-semibold" : "font-normal",
                              "ml-3 block truncate",
                            )}
                          >
                            {model.name}
                          </span>
                        </div>

                        {selected ? (
                          <span
                            className={classNames(
                              active ? "text-white" : "text-blue-600",
                              "absolute inset-y-0 right-0 flex items-center pr-4",
                            )}
                          >
                            <CheckIcon className="h-5 w-5" aria-hidden="true" />
                          </span>
                        ) : null}
                      </>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </Transition>
          </div>
        </div>
      )}
    </Listbox>
  );
};

export default SelectModels;
