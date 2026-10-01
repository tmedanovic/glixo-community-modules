# Workspace Health — TypeScript

This read-only tool uses the host-issued `context.resourceHandles.workspace` handle and an empty workspace search to retrieve a bounded path/size sample. It never reads file contents. The requested scope is `fs.workspace.search` with `projects: ["selected"]`, which the host resolves to the invocation's selected, owned project; it grants no access to other roots.

Search results are sorted locally because host traversal order is not stable. If the result is truncated, the response reports only sample counts and sets `completeProjectTotals` to `null`. It does not turn a partial sample into a project-wide claim.

Build with the pinned `contribution-typescript-v1` recipe and run fixture tests with `npm test`. Host installation and real workspace acceptance remain pending.
