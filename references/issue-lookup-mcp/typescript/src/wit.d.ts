declare module "glixo:http/broker@3.0.0" {
  export function httpStart(request: unknown): number;
  export function httpStatus(handle: number): number;
  export function httpResponseHeaders(handle: number): readonly { name: string; value: string }[];
  export function httpRead(handle: number, maxBytes: number): Uint8Array | undefined;
  export function httpCancel(handle: number): void;
  export function httpDrop(handle: number): void;
}
