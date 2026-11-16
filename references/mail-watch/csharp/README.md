# C# reference

`GuestExportsImpl.Invoke` implements the generic contribution WIT export and delegates to `MailWatch.Handle`. The handler accepts the installed contribution request, an injected `Glixo.ExtensionSdk.Http.IBroker`, and invocation-scoped state. HTTP requests name the declared `oauth` slot; the host resolves its lease without exposing secret contents.

Build the WASM component with the `contribution-csharp-v1` recipe. Locally, restore with `dotnet restore Glixo.Contribution.csproj --locked-mode`, then run `dotnet build Glixo.Contribution.csproj --configuration Release --no-restore -p:RestoreLockedMode=true`. Run protocol fixtures with `dotnet run --project tests/Glixo.MailWatch.Reference.Tests.csproj --configuration Release`.
