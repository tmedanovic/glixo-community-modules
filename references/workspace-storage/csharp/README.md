# Workspace Storage — C#

This project exposes the `storage` tool and stores only under the declared `workspace-storage/test/` prefix. The host stamps package, account, application, and contribution partitions; guest input accepts logical keys only and cannot supply a storage prefix or choose a partition. `set` values are bounded to 4 KiB, list output is sorted and limited to 100 keys, and every invocation uses the host's current storage grant.

The tool includes destructive operations and requests invocation confirmation. It is intended for disposable test values, not application secrets or production data. Shared operation expectations are in `shared/goldens/workspace-storage/namespace-isolation.json`.

Build with the `contribution-csharp-v1` recipe in the pinned SDK support matrix. Run the scoped-state contract checks with `dotnet run --project tests/Glixo.WorkspaceStorage.Tests.csproj`; the repository recipe runner builds and verifies the component. This source has not passed an installed-host acceptance test.
