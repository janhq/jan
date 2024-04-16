export {}

declare global {
  namespace NodeJS {
    interface Global {
      core: any
    }
  }
  let core: any | undefined
}
