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
    className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
  >
    {title}
  </button>
);

export default SecondaryButton;
