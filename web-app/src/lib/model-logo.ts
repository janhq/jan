// Bundled brand logos served from web-app/public. Matching is done on the model
// *family*, so a community quant (e.g. a Gemma repack by some user) still shows
// the recognizable brand mark instead of the quantizer's avatar or a letter.
// To add a brand: drop an SVG/PNG in web-app/public and append a rule. Order
// matters — more specific families first (e.g. deepseek before qwen, since
// "DeepSeek-R1-Distill-Qwen" should resolve to DeepSeek).
const FAMILY_LOGO_RULES: Array<[RegExp, string]> = [
  [/deepseek/i, '/svg/deepseek-color.svg'],
  [/gemma/i, '/svg/gemma-color.svg'],
  [/qwen|qwq/i, '/svg/qwen-color.svg'],
  [/llama|meta-llama/i, '/svg/meta-color.svg'],
  [/mi[sx]tral|magistral|ministral|codestral|devstral/i, '/images/model-provider/mistral.svg'],
]

export function modelFamilyLogoSrc(modelName?: string): string | null {
  if (!modelName) return null
  for (const [pattern, src] of FAMILY_LOGO_RULES) {
    if (pattern.test(modelName)) return src
  }
  return null
}
