# Ollama protocol vectors

The response records in this directory are copied from Ollama's published API examples in `ollama/ollama`'s [`docs/api.md`](https://github.com/ollama/ollama/blob/main/docs/api.md), not synthesized by the Glixo tests. The chat samples retain Ollama's recorded timestamps, model label, counters, finish fields, and tool-call shape. They are protocol examples, not live inference or a claim about a user's installed model.

The provider implementations must also handle byte chunk boundaries that split any record, multiple records in one read, a final record without a trailing newline, malformed JSON, non-success HTTP status, early EOF without `done: true`, and cancellation. Those are transport/error cases and are tested separately; they are not represented as valid Ollama responses here.
