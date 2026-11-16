# C# guest SDK

`Glixo.ExtensionSdk` is a normal .NET library for guest code. It provides typed request/state/log/workspace/event helpers and a bounded broker-response NDJSON reader. The HTTP adapter interface must be implemented with generated WIT imports; the library does not expose `HttpClient`, sockets, native bindings, or process access.

The NuGet package is source-only in this checkout and has not been published. CLI-generated projects vendor this folder at `vendor/glixo-extension-sdk` until a public package release is qualified.
