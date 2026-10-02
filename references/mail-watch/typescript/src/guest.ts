import {
  httpStart, httpStatus, httpResponseHeaders, httpRead, httpCancel, httpDrop,
} from "glixo:http/broker@3.0.0";
import {
  stateGet, stateSet, stateList, stateDelete, log,
} from "glixo:contribution/broker@1.0.0";
import type { Broker, BrokerRequest, Header, Result } from "@glixo/extension-sdk/http";
import type { ScopedState } from "@glixo/extension-sdk/state";
import type { MailServiceRequest, MailServiceResult } from "./mail-watch.js";
import { handleMailWatch } from "./mail-watch.js";

function importResult<T>(operation: () => T): Result<T> {
  try { return { ok: true, value: operation() }; }
  catch (error) {
    const message = typeof error === "string" ? error : error instanceof Error ? error.message : "http_broker_error";
    return { ok: false, error: message.slice(0, 240) };
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const broker: Broker = {
  httpStart: (request: BrokerRequest) => importResult(() => httpStart(request)),
  httpStatus: (handle: number) => importResult(() => httpStatus(handle)),
  httpResponseHeaders: (handle: number) => importResult(() => httpResponseHeaders(handle)),
  httpRead: (handle: number, maxBytes: number) => importResult(() => httpRead(handle, maxBytes)),
  httpCancel: (handle: number) => httpCancel(handle),
  httpDrop: (handle: number) => httpDrop(handle),
};

const scopedState: ScopedState = {
  get: (key: string) => stateGet(key),
  set: (key: string, value: string) => { stateSet(key, value); },
  list: (prefix: string) => stateList(prefix),
  delete: (key: string) => stateDelete(key),
};

/** Generic WIT guest.invoke entry point used by the installed contribution host. */
function invoke(requestJson: string): string {
  try {
    const request: unknown = JSON.parse(requestJson);
    if (!isRecord(request)) throw new Error("guest_request_object_required");
    const result: MailServiceResult = handleMailWatch(request as unknown as MailServiceRequest, broker, scopedState);
    return JSON.stringify(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "mail_watch_invocation_failed";
    try { log("error", message.slice(0, 240)); } catch { /* diagnostic import is best effort */ }
    // componentize-js lowers a thrown string to the WIT result's error case;
    // throwing an Error object escapes as a component trap instead.
    throw message.slice(0, 240);
  }
}

export const guest = { invoke };
