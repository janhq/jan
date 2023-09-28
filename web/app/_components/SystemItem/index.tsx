type Props = {
  name: string;
  total: number;
  used?: number;
};

const SystemItem: React.FC<Props> = ({ name, total, used }) => {
  return (
    <div className="flex gap-2 pl-4">
      <div className="flex gap-[10px] font-bold text-gray-900 text-sm">
        {name}
      </div>
      {used ? (
        <span className="text-gray-900 text-sm">
          {((used / total) * 100).toFixed(0)}%
        </span>
      ) : (
        <span className="text-gray-900 text-sm"> {total}</span>
      )}
    </div>
  );
};

export default SystemItem;
