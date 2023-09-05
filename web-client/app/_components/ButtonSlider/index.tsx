import Image from "next/image";
import React, { PropsWithChildren } from "react";

type PropType = PropsWithChildren<
  React.DetailedHTMLProps<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  >
>;

export const PrevButton: React.FC<PropType> = (props) => {
  const { children, ...restProps } = props;

  return (
    <button
      className="embla__button embla__button--prev"
      type="button"
      {...restProps}
    >
      <Image
        className="rotate-180"
        src={"/icons/chevron-right.svg"}
        width={20}
        height={20}
        alt=""
      />
      {children}
    </button>
  );
};

export const NextButton: React.FC<PropType> = (props) => {
  const { children, ...restProps } = props;

  return (
    <button
      className="embla__button embla__button--next"
      type="button"
      {...restProps}
    >
      <Image src={"/icons/chevron-right.svg"} width={20} height={20} alt="" />
      {children}
    </button>
  );
};
