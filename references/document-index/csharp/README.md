# document-index — C#

This regular sandboxed WebAssembly component uses the Glixo generic contribution world, host-stamped workspace handle, and the shared C# SDK. No native trusted installation is needed.

Use `glxdev build` from a scaffolded copy with its vendored SDK. For direct repository builds, run `dotnet restore Glixo.Contribution.csproj`, then `dotnet build Glixo.Contribution.csproj -c Release --no-restore -p:RestoreLockedMode=true`. The copy target writes `dist/glixo-extension.component.wasm`.

The manifest is a scaffold template: the CLI replaces package ID and name. Its component digest is inserted after building; this source does not claim an artifact digest.

Search matches path substrings. Files above 4 KiB are not read; UTF-8 excerpts stay within 96 bytes. The data-source manifest permits at most 20 results from the selected project.
