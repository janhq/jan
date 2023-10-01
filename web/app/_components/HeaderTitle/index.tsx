import React from 'react';

type Props = {
  title: string;
};

const HeaderTitle: React.FC<Props> = ({ title }) => (
  <h2 className="my-5 font-semibold text-[34px] tracking-[-0.4px] leading-[41px]">
    {title}
  </h2>
);

export default React.memo(HeaderTitle);
