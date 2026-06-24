/** Best-effort relay of message.ingested pointer events to the host capability endpoint. */
export async function relayMessageIngestedToHost(payload: Record<string, unknown>): Promise<void> {
  const url = process.env.GLIXO_HOST_MESSAGE_INGEST_URL
    ?? process.env.GLIXO_CAPABILITY_MESSAGE_INGEST_URL;
  if (!url?.trim()) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ eventType: 'message.ingested', ...payload }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Host relay is optional in dev; module outbox remains authoritative.
  }
}
