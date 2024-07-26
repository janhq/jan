export const addThousandSeparator = (
  num: number,
  separator: string = ','
): string => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, separator)
}
