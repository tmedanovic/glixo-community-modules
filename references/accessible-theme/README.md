# Accessible theme and controls

This source package shares Glixo semantic theme tokens, a sandbox bridge for receiving host theme updates and invoking manifest-declared actions, and reusable keyboard-visible browser controls. Import `connectTheme()` once at the sandbox entry, load `src/extension-ui.css`, and call `installGlixoExtensionUi()` before using the `glixo-*` custom elements.

The bridge accepts only the host-provided theme object and declared action IDs. Treat action results as untrusted JSON. The host controls the opaque frame, placement, asset digests, CSP nonce, and action allowlist; this package grants no extra placement or host authority.

`placements.json` is the source placement registry snapshot. Only entries marked `supported` are current placements; `planned` IDs are documentation and must not be declared by templates. The browser source is a reference library, not a claim of host qualification or marketplace admission.

The semantic palette and focus-visible treatment follow the Glixo shared shell. Components include labels for form controls, explicit dialog labels, and focus outlines; product-specific contrast acceptance must still be checked against the actual configured theme and platform.
