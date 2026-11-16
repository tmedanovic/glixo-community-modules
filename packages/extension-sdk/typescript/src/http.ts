export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface Header {
  readonly name: string;
  readonly value: string;
}

/** Mirrors glixo:http/types@3.0.0. Adapters call generated WIT imports. */
export interface BrokerRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: readonly Header[];
  readonly body?: Uint8Array;
  readonly contentType?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly acceptedStatusMin?: number;
  readonly acceptedStatusMax?: number;
  readonly endpointHandle?: string;
  /** Invocation-scoped secret slot name, never secret contents or a lease id. */
  readonly secretHandle?: string;
  readonly authHeader?: string;
  readonly authScheme?: string;
}

export interface Broker {
  httpStart(request: BrokerRequest): Result<number>;
  httpStatus(handle: number): Result<number>;
  httpResponseHeaders(handle: number): Result<readonly Header[]>;
  /** `undefined` is the WIT `none` EOF value; an empty Uint8Array is an empty chunk. */
  httpRead(handle: number, maxBytes: number): Result<Uint8Array | undefined>;
  httpCancel(handle: number): void;
  httpDrop(handle: number): void;
}

export const DEFAULT_READ_BYTES = 16 * 1024;
export const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

/** Bounded NDJSON line reader that supports split and coalesced broker reads. */
export class NdjsonStream {
  readonly #broker: Broker;
  readonly #handle: number;
  readonly #maxLineBytes: number;
  #pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  #eof = false;
  #released = false;

  constructor(broker: Broker, request: BrokerRequest, maxLineBytes = DEFAULT_MAX_LINE_BYTES) {
    this.#broker = broker;
    const started = broker.httpStart(request);
    if (!started.ok) throw new Error(started.error);
    this.#handle = started.value;
    this.#maxLineBytes = Math.max(1, maxLineBytes);
  }

  responseHeaders(): readonly Header[] {
    const result = this.#broker.httpResponseHeaders(this.#handle);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  status(): number {
    const result = this.#broker.httpStatus(this.#handle);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  nextLine(): Uint8Array | undefined {
    while (true) {
      const newline = this.#pending.indexOf(10);
      if (newline >= 0) {
        if (newline > this.#maxLineBytes) throw new Error("ndjson_line_too_large");
        const line = this.#pending.slice(0, newline);
        this.#pending = this.#pending.slice(newline + 1);
        return trimCr(line);
      }
      if (this.#pending.byteLength > this.#maxLineBytes) throw new Error("ndjson_line_too_large");
      if (this.#eof) {
        if (this.#pending.byteLength === 0) return undefined;
        const line = trimCr(this.#pending);
        this.#pending = new Uint8Array(0);
        if (line.byteLength > this.#maxLineBytes) throw new Error("ndjson_line_too_large");
        return line;
      }
      const result = this.#broker.httpRead(this.#handle, DEFAULT_READ_BYTES);
      if (!result.ok) throw new Error(result.error);
      if (result.value === undefined) {
        this.#eof = true;
      } else if (result.value.byteLength > 0) {
        this.#pending = concat(this.#pending, result.value);
      }
    }
  }

  cancel(): void {
    if (this.#released) return;
    this.#broker.httpCancel(this.#handle);
    this.close();
  }

  close(): void {
    if (this.#released) return;
    this.#broker.httpDrop(this.#handle);
    this.#released = true;
  }
}

function trimCr(line: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  return line.at(-1) === 13 ? line.slice(0, -1) : line;
}

function concat(left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left);
  joined.set(right, left.byteLength);
  return joined;
}
