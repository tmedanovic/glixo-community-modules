# workspace-health — C#

This regular sandboxed WebAssembly component uses the Glixo generic contribution world, host-stamped workspace handle, and the shared C# SDK. No native trusted installation is needed.

Use `glxdev build` from a scaffolded copy with its vendored SDK. For direct repository builds, run `dotnet restore Glixo.Contribution.csproj`, then `dotnet build Glixo.Contribution.csproj -c Release --no-restore -p:RestoreLockedMode=true`. The copy target writes `dist/glixo-extension.component.wasm`.

The manifest is a scaffold template: the CLI replaces package ID and name. Its component digest is inserted after building; this source does not claim an artifact digest.

The inventory is a bounded sample of files eligible for broker traversal. Ignored directories, generated output and reparse points are omitted. Complete eligible totals are supplied only when the host says the sample is not truncated.
