import { log } from "@janhq/core/node";

export const debugInspectorSync =
  <T, U>(fn: (...args: T[]) => U) =>
  (...params: Parameters<typeof fn>): U => {
    log(`[${fn.name}] running with params ${JSON.stringify(params)}`);
    try {
      const res = fn(...params);
      log(`[${fn.name}] returns ${JSON.stringify(res)}`);
      return res;
    } catch (err: any) {
      log(`[${fn.name}] failed with ${err}`);
      throw err;
    }
  };

export const debugInspector =
  <T, U>(fn: (...args: T[]) => Promise<U>) =>
  async (...params: Parameters<typeof fn>): Promise<U> => {
    log(`[${fn.name}] running with params ${JSON.stringify(params)}`);
    return await fn(...params)
      .then((res: any): any => {
        log(`[${fn.name}] returns ${JSON.stringify(res)}`);
        return res;
      })
      .catch((err: any): never => {
        log(`[${fn.name}] failed with ${err}`);
        throw err;
      });
  };
