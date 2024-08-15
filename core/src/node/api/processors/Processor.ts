export abstract class Processor {
  abstract process(key: string, ...args: any[]): any
}
