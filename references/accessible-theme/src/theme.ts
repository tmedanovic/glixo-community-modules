export interface GlixoThemeTokens {
    background: string;
    panel: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    border: string;
    danger: string;
    warning: string;
    success: string;
    fontFamily: string;
    radius: string;
    spacing: string;
}

export interface GlixoSandboxHost {
    readonly theme: Readonly<Partial<GlixoThemeTokens>>;
    readonly locale: string;
    /** Per-frame CSP style nonce, used only for inline component styles. */
    readonly styleNonce: string;
    ready(): Promise<{ ready: boolean }>;
    invoke(actionId: string, payload?: Record<string, unknown>): Promise<{ completed: boolean }>;
}

declare global {
    interface Window {
        readonly glixoExtension?: GlixoSandboxHost;
    }
}

export function currentTheme(): Readonly<Partial<GlixoThemeTokens>> {
    return window.glixoExtension?.theme ?? {};
}

export function subscribeTheme(listener: (tokens: Readonly<Partial<GlixoThemeTokens>>) => void): () => void {
    const handler = (event: Event) => listener((event as CustomEvent<Readonly<Partial<GlixoThemeTokens>>>).detail ?? {});
    window.addEventListener('glixo-theme', handler);
    listener(currentTheme());
    return () => window.removeEventListener('glixo-theme', handler);
}

export function applyTheme(tokens: Readonly<Partial<GlixoThemeTokens>> = currentTheme(), root: HTMLElement = document.documentElement): void {
    const cssNames: Readonly<Record<keyof GlixoThemeTokens, string>> = {
        background: '--glixo-color-background', panel: '--glixo-color-panel', surface: '--glixo-color-surface',
        text: '--glixo-color-text', muted: '--glixo-color-muted', accent: '--glixo-color-accent',
        border: '--glixo-color-border', danger: '--glixo-color-danger', warning: '--glixo-color-warning',
        success: '--glixo-color-success', fontFamily: '--glixo-font-family', radius: '--glixo-radius-control',
        spacing: '--glixo-space-scale',
    };
    const declarations = (Object.entries(tokens) as Array<[keyof GlixoThemeTokens, string]>)
        .filter(([, value]) => typeof value === 'string'
            && value.length <= 256
            && !/[<>;]/.test(value)
            && !/(?:url|expression)\s*\(/i.test(value))
        .map(([key, value]) => `${cssNames[key]}:${value}`);
    const selector = root === document.documentElement ? ':root' : '[data-glixo-theme-root]';
    let style = root.querySelector<HTMLStyleElement>('style[data-glixo-extension-theme]');
    if (!style) {
        style = document.createElement('style');
        style.dataset.glixoExtensionTheme = '';
        style.nonce = window.glixoExtension?.styleNonce ?? '';
        root.appendChild(style);
    }
    style.textContent = `${selector}{${declarations.join(';')}}`;
}

export function connectTheme(root: HTMLElement = document.documentElement): () => void {
    const unsubscribe = subscribeTheme(tokens => applyTheme(tokens, root));
    const initial = window.glixoExtension?.ready;
    if (initial) void initial().catch(() => undefined);
    return unsubscribe;
}

// SOURCE_TABS: shared-theme-controls
// docs:snippet-start shared-theme-controls:typescript
export const sharedThemeControls = Object.freeze({
    colors: Object.freeze({ background: 'var(--glixo-color-background)', panel: 'var(--glixo-color-panel)', surface: 'var(--glixo-color-surface)', text: 'var(--glixo-color-text)', muted: 'var(--glixo-color-muted)', accent: 'var(--glixo-color-accent)', border: 'var(--glixo-color-border)', danger: 'var(--glixo-color-danger)', warning: 'var(--glixo-color-warning)', success: 'var(--glixo-color-success)' }),
    fontFamily: 'var(--glixo-font-family)',
    radius: 'var(--glixo-radius-control)',
    spacing: 'var(--glixo-space-scale)',
});
// docs:snippet-end shared-theme-controls:typescript
