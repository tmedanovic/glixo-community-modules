export * from './theme.js';
export * from './components.js';

import { registerGlixoElements } from './components.js';

/** Call once from a sandboxed-web package entry before rendering custom elements. */
export function installGlixoExtensionUi(): void {
    registerGlixoElements();
}
