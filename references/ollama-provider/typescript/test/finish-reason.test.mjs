import test from "node:test";
import assert from "node:assert/strict";
import { mapFinishReason } from "../dist/js/finish-reason.js";

test("tool-call turns map Ollama done_reason stop to the tool handoff", () => {
  assert.equal(mapFinishReason("stop", true), "tool");
});

test("ordinary stop and length finish reasons remain unchanged", () => {
  assert.equal(mapFinishReason("stop", false), "stop");
  assert.equal(mapFinishReason("length", false), "length");
});
