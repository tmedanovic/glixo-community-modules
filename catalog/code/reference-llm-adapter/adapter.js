#!/usr/bin/env node
/*
 * Reference out-of-process LLM adapter for the `glixo.adapter.llm.v1` contract.
 *
 * The host spawns this process (from the manifest's `contributes.adapters[0]`:
 * `node adapter.js`, cwd = the extension's install dir) and drives it over stdio
 * with newline-delimited JSON. This reference echoes the last user message so the
 * whole spawn -> stream -> proxy path works with zero configuration.
 *
 * ── Wire protocol ────────────────────────────────────────────────────────────
 * host -> adapter (one request per line):
 *   { "id": "<corr>", "model": "<id>",
 *     "messages": [ { "role": "system|user|assistant|tool", "content": "..." } ],
 *     "options": { "temperature"?: number, "maxOutputTokens"?: number } }
 *
 * adapter -> host (newline-delimited, correlated by `id`):
 *   { "id": "<corr>", "delta": "<text>" }                       // zero or more
 *   { "id": "<corr>", "done": true, "finishReason": "stop",
 *     "usage": { "inputTokens": n, "outputTokens": n } }         // exactly one terminal
 *   — or, on failure —
 *   { "id": "<corr>", "error": "<message>" }
 *
 * ── Credentials ──────────────────────────────────────────────────────────────
 * A real provider authenticates here. The host never sends secrets on the wire;
 * it injects the selected account into this process's environment under well-known
 * keys, so the extension never stores the raw credential itself:
 *   process.env.GLIXO_ADAPTER_API_KEY   // the account's apiKey, if any
 *   process.env.GLIXO_ADAPTER_BASE_URL  // the account's baseUrl, if any
 *   process.env.GLIXO_ADAPTER_MODEL     // the session's resolved model id
 * The echo reference needs none of these.
 */

'use strict';

const rl = require('readline').createInterface({ input: process.stdin });

function lastUserContent(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') return typeof m.content === 'string' ? m.content : '';
  }
  return '';
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return; // ignore malformed input rather than crash the long-lived adapter
  }
  const id = req && req.id;
  if (id === undefined || id === null) return;

  try {
    const messages = Array.isArray(req.messages) ? req.messages : [];
    const prompt = lastUserContent(messages);
    const text = 'echo: ' + prompt;

    // Stream the reply in 4-char deltas, then a single terminal event.
    for (let i = 0; i < text.length; i += 4) {
      send({ id, delta: text.slice(i, i + 4) });
    }
    send({
      id,
      done: true,
      finishReason: 'stop',
      usage: { inputTokens: prompt.length, outputTokens: text.length },
    });
  } catch (err) {
    send({ id, error: String((err && err.message) || err) });
  }
});
