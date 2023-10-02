type Props = {
  title: string;
  onClick: () => void;
  disabled?: boolean;
};

const SecondaryButton: React.FC<Props> = ({ title, onClick, disabled }) => (
  <button
    disabled={disabled}
    type="button"
    onClick={onClick}
    className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
  >
    {title}
  </button>
);

export default SecondaryButton;
