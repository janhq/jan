export interface HttpServer {
  post: (route: string, handler: (req: any, res: any) => Promise<any>) => void
  get: (route: string, handler: (req: any, res: any) => Promise<any>) => void
  patch: (route: string, handler: (req: any, res: any) => Promise<any>) => void
  put: (route: string, handler: (req: any, res: any) => Promise<any>) => void
  delete: (route: string, handler: (req: any, res: any) => Promise<any>) => void
  register: (router: any, opts?: any) => void
}
