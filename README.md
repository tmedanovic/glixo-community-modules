# Glixo extension examples

Build extensions for Glixo using **C#, Go, Rust, or TypeScript**. This repository contains examples you can read, build, and adapt for your own project.

## Choose an example

Each code example has a folder for all four languages.

| Example | What it does |
| --- | --- |
| [Ollama provider](references/ollama-provider) | Connects Glixo to Ollama for model discovery, chat, and tool calls. |
| [Workspace health](references/workspace-health) | Checks a workspace and reports problems. |
| [Document search](references/document-index) | Searches project files and returns matching excerpts. |
| [Extension storage](references/workspace-storage) | Saves and reads extension data. |
| [Issue lookup](references/issue-lookup-mcp) | Looks up issues through an MCP server. |
| [Mail watcher](references/mail-watch) | Watches a Microsoft 365 inbox and sends new-mail events to Glixo. |
| [Conversation insights](references/conversation-insights) | Counts messages and tool usage without saving prompt text. |
| [Prompt redactor](references/prompt-redactor) | Removes configured text from outgoing messages. |
| [Custom settings panel](references/accessible-theme) | Adds a panel with a custom Web Component, Glixo's colors, and saved preferences. |

There is also a [review checklist](references/review-checklist) for checking an extension before sharing it.

## Build an example

Start with the Ollama provider in your preferred language: [C#](references/ollama-provider/csharp), [Go](references/ollama-provider/go), [Rust](references/ollama-provider/rust), or [TypeScript](references/ollama-provider/typescript).

Clone this repository and install its JavaScript dependencies:

```sh
git clone https://github.com/tmedanovic/glixo-community-modules.git
cd glixo-community-modules
npm ci
```

Use Node.js 22.14 or newer. Before building, install the compiler and WebAssembly tools listed for your language in [required tool versions](packages/extension-sdk/support-matrix.json).

For example, build and check the TypeScript Ollama provider:

```sh
npm run build:references -- --reference=ollama-provider --language=typescript
```

Replace `typescript` with `csharp`, `go`, or `rust`. Replace `ollama-provider` with another example's folder name to try it. The command builds in a temporary directory and checks the result.

To check all example manifests and shared files:

```sh
npm run verify
```

The examples are under active development. Building one does not install it in Glixo; using services such as Ollama or Microsoft 365 also requires their own setup.

## Make it your own

- The source code is in `references/<example>/<language>/`.
- `glixo.extension.json` describes what the extension adds and which permissions it needs.
- [The SDK](packages/extension-sdk) provides shared helpers for each language.
- [`glxdev`](https://www.npmjs.com/package/@glixo/glxdev) is Glixo's command-line tool for creating, building, and packaging extensions. See the [developer docs](https://docs.glixo.dev/) for its commands and the installation process.

## License

[MIT](LICENSE), unless a directory includes a separate third-party notice.
