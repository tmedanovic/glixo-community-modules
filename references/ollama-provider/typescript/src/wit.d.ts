declare module "glixo:http/broker@3.0.0" {
  export function httpStart(request: any): any;
  export function httpStatus(handle: number): any;
  export function httpResponseHeaders(handle: number): any;
  export function httpRead(handle: number, maxBytes: number): any;
  export function httpCancel(handle: number): void;
  export function httpDrop(handle: number): void;
}
declare module "glixo:llm-provider-compat/provider-host@3.0.0" {
  export function log(level: string, message: string): void;
}
