export function createToolUseCounterStore() {
  const counts = new Map();
  return {
    record(toolName) {
      const key = String(toolName || 'unknown');
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts.get(key);
    },
    snapshot() {
      return Array.from(counts, ([toolName, count]) => ({ toolName, count }));
    },
  };
}
