/** Direct host-stamped contribution invoke JSON object. */
export interface GuestEnvelope<TConfiguration = unknown, TInput = unknown> {
  readonly kind: string;
  readonly contributionId: string;
  readonly configuration: TConfiguration;
  readonly input: TInput;
  readonly context: GuestContext;
}

export interface GuestContext {
  readonly sessionId: string;
  readonly resourceHandles: Readonly<Record<string, string>>;
  readonly endpoints: readonly EndpointGrant[];
}

export interface EndpointGrant {
  readonly name: string;
  readonly handle: string;
  readonly baseUrl: string;
}

export interface GuestReply<TResponse = unknown> {
  readonly response: TResponse;
}
