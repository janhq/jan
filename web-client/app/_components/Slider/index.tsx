import { FC, useCallback, useEffect, useState } from "react";
import Slide from "../Slide";
import useEmblaCarousel, { EmblaCarouselType } from "embla-carousel-react";
import { NextButton, PrevButton } from "../ButtonSlider";
import { Product } from "@/_models/Product";

type Props = {
  products: Product[];
};

const Slider: FC<Props> = ({ products }) => {
  const [emblaRef, emblaApi] = useEmblaCarousel();
  const [prevBtnDisabled, setPrevBtnDisabled] = useState(true);
  const [nextBtnDisabled, setNextBtnDisabled] = useState(true);

  const scrollPrev = useCallback(
    () => emblaApi && emblaApi.scrollPrev(),
    [emblaApi]
  );
  const scrollNext = useCallback(
    () => emblaApi && emblaApi.scrollNext(),
    [emblaApi]
  );

  const onSelect = useCallback((emblaApi: EmblaCarouselType) => {
    setPrevBtnDisabled(!emblaApi.canScrollPrev());
    setNextBtnDisabled(!emblaApi.canScrollNext());
  }, []);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect(emblaApi);
    emblaApi.on("reInit", onSelect);
    emblaApi.on("select", onSelect);
  }, [emblaApi, onSelect]);

  return (
    <div className="embla rounded-lg overflow-hidden relative mt-6 mx-6">
      <div className="embla__viewport" ref={emblaRef}>
        <div className="embla__container">
          {products.map((product) => (
            <Slide key={product.slug} product={product} />
          ))}
        </div>
      </div>
      <div className="embla__buttons">
        <PrevButton onClick={scrollPrev} disabled={prevBtnDisabled} />
        <NextButton onClick={scrollNext} disabled={nextBtnDisabled} />
      </div>
    </div>
  );
};

export default Slider;
