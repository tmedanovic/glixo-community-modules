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

export type GlixoTheme = Readonly<Partial<GlixoThemeTokens>>;

interface GlixoSandboxedWebApi {
    readonly theme: Readonly<Record<string, unknown>>;
    readonly locale: string;
    readonly styleNonce: string;
    ready(): Promise<Record<string, unknown>>;
    invoke(actionId: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

declare global {
    interface Window {
        readonly glixoExtension?: GlixoSandboxedWebApi;
    }
}

const TOKEN_NAMES: Readonly<Record<keyof GlixoThemeTokens, string>> = {
    background: '--glixo-color-background', panel: '--glixo-color-panel', surface: '--glixo-color-surface',
    text: '--glixo-color-text', muted: '--glixo-color-muted', accent: '--glixo-color-accent',
    border: '--glixo-color-border', danger: '--glixo-color-danger', warning: '--glixo-color-warning',
    success: '--glixo-color-success', fontFamily: '--glixo-font-family', radius: '--glixo-radius-control',
    spacing: '--glixo-space-scale',
};

let theme: GlixoTheme = {};
const themeListeners = new Set<(tokens: GlixoTheme) => void>();

function normalizeTheme(value: unknown): GlixoTheme {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized: Partial<GlixoThemeTokens> = {};
    for (const [key, item] of Object.entries(value)) {
        if (key in TOKEN_NAMES && typeof item === 'string') {
            Object.assign(normalized, { [key]: item });
        }
    }
    return normalized;
}

function publishTheme(value: unknown): void {
    theme = normalizeTheme(value);
    themeListeners.forEach(listener => listener(theme));
}

export function currentTheme(): GlixoTheme { return theme; }

export function subscribeTheme(listener: (tokens: GlixoTheme) => void): () => void {
    themeListeners.add(listener);
    listener(theme);
    return () => themeListeners.delete(listener);
}

export function applyTheme(tokens: GlixoTheme = theme, root: HTMLElement = document.documentElement): void {
    for (const [key, value] of Object.entries(tokens) as Array<[keyof GlixoThemeTokens, string]>) {
        if (typeof value !== 'string' || value.length > 256 || /[<>;]/.test(value) || /(?:url|expression)\s*\(/i.test(value)) continue;
        root.style.setProperty(TOKEN_NAMES[key], value);
    }
}

/** Subscribe to the theme event dispatched by the injected glixoExtension bridge. */
export function connectTheme(root: HTMLElement = document.documentElement): () => void {
    const host = window.glixoExtension;
    if (!host) return () => undefined;

    let readyRequested = false;
    const onTheme = (event: Event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        publishTheme(detail ?? host.theme);
        applyTheme(theme, root);
        if (!readyRequested) {
            readyRequested = true;
            void host.ready().catch(() => undefined);
        }
    };
    const onLocale = (event: Event) => {
        const locale = (event as CustomEvent<unknown>).detail;
        if (typeof locale === 'string') document.documentElement.lang = locale;
    };
    window.addEventListener('glixo-theme', onTheme);
    window.addEventListener('glixo-locale', onLocale);
    publishTheme(host.theme);
    applyTheme(theme, root);
    return () => {
        window.removeEventListener('glixo-theme', onTheme);
        window.removeEventListener('glixo-locale', onLocale);
    };
}

export async function invoke(actionId: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!/^[a-z0-9][a-z0-9.-]{1,127}$/.test(actionId)) throw new Error('action_id_invalid');
    const host = window.glixoExtension;
    if (!host) throw new Error('sandbox_bridge_unavailable');
    return host.invoke(actionId, payload);
}
