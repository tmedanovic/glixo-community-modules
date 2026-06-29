# GitNexus

GitNexus is a Glixo Code extension that contributes the local GitNexus MCP server
and a skill that teaches agents how to use it for repository graph questions.

## What It Contributes

- **MCP server - `gitnexus`**: starts `npx -y gitnexus@1.6.5 mcp` with
  `GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1`, exposing GitNexus tools in sessions as
  `mcp__gitnexus__*`.
- **Skill - "GitNexus"** (`skills/gitnexus`): guidance for when to query the
  indexed graph instead of doing broad text search, and how to refresh indexes.

## Setup

Index each repository before expecting useful answers:

```powershell
npx gitnexus@1.6.5 analyze .
```

GitNexus stores its registry under the user's home directory, so one local MCP
server can serve every indexed repository on the machine.

## Permissions And Capabilities

Required capabilities:

- `capability.glixo.agent.mcp.register` - register the GitNexus MCP server for
  new agent sessions.
- `capability.glixo.agent.skills.register` - register the bundled GitNexus
  skill.

The extension does not register a separate daemon-handled tool. The actual
model-visible tools come from the GitNexus MCP server after it connects.
