import { log } from "@janhq/core/node";

export const debugInspector =
  (fn: Function) =>
  async (...params: any[]): Promise<any> => {
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
