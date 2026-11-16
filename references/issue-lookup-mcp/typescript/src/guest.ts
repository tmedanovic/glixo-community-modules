import { httpCancel, httpDrop, httpRead, httpResponseHeaders, httpStart, httpStatus } from "glixo:http/broker@3.0.0";
import type { Broker } from "@glixo/extension-sdk/http";
import { lookupIssue } from "./handler.js";

function fromHost<T>(call: () => T): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string } {
  try { return { ok: true, value: call() }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "http_broker_error" }; }
}
const broker: Broker = {
  httpStart: (request) => fromHost(() => httpStart(request)),
  httpStatus: (handle) => fromHost(() => httpStatus(handle)),
  httpResponseHeaders: (handle) => fromHost(() => httpResponseHeaders(handle)),
  httpRead(handle, maxBytes) {
    return fromHost(() => httpRead(handle, maxBytes));
  },
  httpCancel,
  httpDrop
};
export const guest = {
  invoke(requestJson: string): string {
    try {
      const envelope = JSON.parse(requestJson);
      return JSON.stringify(lookupIssue(envelope, broker));
    } catch (error) {
      throw errorPayload(error, "issue_lookup_failed");
    }
  }
};

function errorPayload(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return message.slice(0, 240) || fallback;
}
