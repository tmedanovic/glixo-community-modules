import { handleWorkflowTextStats, stableError } from './handler.js';

// docs:snippet-start workflow-text-stats-guest:typescript
export const guest = {
  invoke(requestJson: string): string {
    try { return JSON.stringify(handleWorkflowTextStats(requestJson)); }
    catch (error) { throw stableError(error); }
  },
};
// docs:snippet-end workflow-text-stats-guest:typescript
