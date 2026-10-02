export type OllamaFinishTag = "stop" | "length" | "tool" | "unknown";

export function mapFinishReason(reason: string | undefined, toolCallsSeen: boolean): OllamaFinishTag {
  if (toolCallsSeen || reason === "tool" || reason === "tool_calls") return "tool";
  if (reason === "length") return "length";
  if (reason === "stop" || !reason) return "stop";
  return "unknown";
}
