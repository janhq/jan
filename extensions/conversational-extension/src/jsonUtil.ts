// Note about performance
// The v8 JavaScript engine used by Node.js cannot optimise functions which contain a try/catch block.
// v8 4.5 and above can optimise try/catch
export function safelyParseJSON(json) {
  // This function cannot be optimised, it's best to
  // keep it small!
  var parsed
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    return undefined
  }
  return parsed // Could be undefined!
}
