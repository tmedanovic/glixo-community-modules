# TypeScript reference

`src/guest.ts` exports the generic contribution WIT `guest.invoke` adapter and delegates to `handleMailWatch`. The handler uses the SDK `Broker` and scoped state. It checks for the invocation's `oauth` resource slot and passes that declared slot name to the broker; no secret value is read from configuration.

Build the WASM component with the `contribution-typescript-v1` recipe or run `npm ci --ignore-scripts` followed by `npm run build`; run protocol fixtures with `npm test`.
