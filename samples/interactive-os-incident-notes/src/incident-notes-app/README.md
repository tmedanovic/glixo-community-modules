# Interactive OS Incident Notes

This sample contributes a host-rendered Interactive OS app through
`contributes.interactiveOs.apps`.

The current artifact is intentionally tiny: Glixo Code registers the app over
the existing Interactive OS bridge after the Extension is installed, while the
host keeps arbitrary third-party UI code out of the iframe.
