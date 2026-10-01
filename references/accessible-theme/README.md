# Accessible theme and controls

This reference is an installable extension package template. Each language folder contains a manifest v2 package and a separately built contribution guest. The browser panel is the digest-bound static HTML asset at `ui/index.html`; it is not a WASM module and does not become one when copied into a language project.

The `src/` TypeScript package is a reusable `@glixo/extension-ui` bridge/control helper for extension authors. It is separate from the installable sample's static browser asset and from each language's action guest.

The isolated panel owns the `<glixo-user-custom-control>` Web Component and its HTML color input; this is extension-authored UI, not a host-rendered schema control. It uses Glixo semantic CSS variables with a near-black fallback palette, announces `guest.ready`, receives host theme tokens, and invokes the manifest-declared `save-preferences` action through the `sandboxed-web.v1` bridge. Host-owned menus and basic controls remain Glixo primitives. The action reaches a normal `glixo:contribution/contribution@1.0.0` guest with `kind: "actions"` and `contributionId: "save-preferences"`; each language guest validates the submitted values and stores them only under `accessible-theme/preferences/`.

The package declares `settings.extensions`, currently a supported sandboxed-web placement on web. Web host installation has not been exercised by this reference build, and native custom-web acceptance is unavailable, so host acceptance remains pending. CI verifies the shared HTML digest in all four manifests and builds the four contribution guests as distinct artifacts.

Build the C#, Go, Rust, or TypeScript contribution guest by following that language folder's README. The browser asset itself needs no compiler or componentizer.
