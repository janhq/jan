/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Class with static methods.
 *
 * @class jsonToCssVar
 */

// eslint-disable-next-line @typescript-eslint/naming-convention
export default class jsonToCssVar {
  /**
   * Converts JSON object to CSS variables.
   *
   * @static
   * @memberof jsonToCssVar
   * @param {object} props
   * @param {object} props.json
   * @param {string} props.cssIndent
   * @param {string} props.cssPrefix
   * @param {string} props.cssSelector
   * @returns {string}
   */

  static convert = ({
    json = {} as object,
    cssIndent = '  ' as string,
    cssPrefix = '--' as string,
    cssSelector = ':root' as string,
  }): string => {
    const oldStr: string = this.flatten(json)

    const oldList: string[] = oldStr.split(';').sort()

    const newList: string[] = []

    oldList.forEach((item: string = ''): void => {
      if (item) {
        newList.push(`${cssIndent}${cssPrefix}${item};`)
      }
    })

    const newStr: string = newList.join('\n')
    return `${cssSelector} {\n${newStr}\n}`
  }

  /**
   * Flattens JSON keys/values into a string.
   *
   * @static
   * @memberof jsonToCssVar
   * @param {object} json
   * @param {string} prevStr
   * @returns {string}
   */
  static flatten = (json: object = {}, prevStr: string = ''): string => {
    let mainStr: string = ''

    Object.entries(json).forEach(([key = '', value = '']): void => {
      let tempStr: string = this.parseKey(key)

      if (prevStr) {
        tempStr = `${prevStr}-${tempStr}`
      }

      if (this.isObject(value)) {
        tempStr = this.flatten(value, tempStr)
      } else {
        const newValue: string = Array.isArray(value)
          ? value.map(this.parseValue).join(', ')
          : this.parseValue(value)

        tempStr = `${tempStr}: ${newValue};`
      }

      mainStr += tempStr
    })

    return mainStr
  }

  /**
   * Checks if a value is an object.
   *
   * @static
   * @memberof jsonToCssVar
   * @param {object} obj
   * @returns {boolean}
   */
  static isObject = (obj: object | null = null): boolean => {
    return !!(obj && typeof obj === 'object' && !Array.isArray(obj))
  }

  /**
   * Normalizes keys to kebab case.
   *
   * @static
   * @memberof jsonToCssVar
   * @param {string} key
   * @returns {string}
   */
  static parseKey = (key: string = ''): string => {
    let newKey: string = String(key)
    newKey = newKey.trim()
    newKey = newKey.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    newKey = newKey.replace(/\s+/g, '-')
    newKey = newKey.replace(/_+/g, '-')
    newKey = newKey.replace(/-+/g, '-')
    newKey = newKey.toLowerCase()

    if (newKey.startsWith('-')) {
      newKey = newKey.slice(1)
    }

    if (newKey.endsWith('-')) {
      newKey = newKey.slice(0, -1)
    }

    return newKey
  }

  /**
   * Potentially quotes CSS value.
   *
   * @static
   * @memberof jsonToCssVar
   * @param {string} value
   * @returns {string}
   */
  static parseValue = (value: string = ''): string => {
    let newValue: string = String(value)
    newValue = newValue.trim()
    newValue = newValue.replace(/\s+/g, ' ')

    if (newValue.match(/\s/g) && newValue.toLowerCase() !== newValue) {
      newValue = `'${newValue}'`
    }

    return newValue
  }
}
