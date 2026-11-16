# Issue Lookup MCP (Go)

This guest exposes one `issue-lookup` tool that calls the `issues.lookup` tool on a user-approved local MCP Streamable HTTP connection. It accepts an issue key such as `DEMO-17`, sends one bounded `tools/call` request to `/mcp`, and returns only the single bounded text item. It does not accept a URL or endpoint handle from tool input; the host-issued `issues` endpoint grant and opaque connection handle are required for every call.

The manifest requests `http.connection` only for the `issues` endpoint, `POST`, and `/mcp`. It has no local stdio transport and does not target arbitrary public HTTPS services. The HTTP broker caps requests at 15 seconds and responses at 128 KiB; response handles are dropped, and failed calls are cancelled before release.

Run the project fixture tests with `go test ./...`; build and WIT verification use the pinned `contribution-go-v1` recipe. These source and fixture checks do not establish an installed-host connection, package admission, or live issue-tracker acceptance.


