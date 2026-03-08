export {}

declare global {
  namespace NodeJS {
    interface Global {
      core: any
    }
  }
  var core: any | undefined
}
