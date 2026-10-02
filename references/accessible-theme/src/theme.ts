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

interface Bootstrap {
    readonly protocol: 'glixo.sandboxed-web.bridge';
    readonly schema: 1;
    readonly instanceNonce: string;
}

interface BridgeEnvelope {
    readonly contractKind: 'sandboxed-web-bridge';
    readonly protocol: 'glixo.sandboxed-web.bridge';
    readonly schema: 1;
    readonly kind: 'request' | 'response' | 'event' | 'error';
    readonly instanceNonce: string;
    readonly sequence: number;
    readonly requestId?: string;
    readonly operation?: string;
    readonly payload?: Record<string, unknown>;
    readonly error?: { readonly code: string; readonly message?: string };
}

declare global {
    interface Window {
        readonly __GLIXO_SANDBOXED_WEB__?: Bootstrap;
    }
}

const TOKEN_NAMES: Readonly<Record<keyof GlixoThemeTokens, string>> = {
    background: '--glixo-color-background', panel: '--glixo-color-panel', surface: '--glixo-color-surface',
    text: '--glixo-color-text', muted: '--glixo-color-muted', accent: '--glixo-color-accent',
    border: '--glixo-color-border', danger: '--glixo-color-danger', warning: '--glixo-color-warning',
    success: '--glixo-color-success', fontFamily: '--glixo-font-family', radius: '--glixo-radius-control',
    spacing: '--glixo-space-scale',
};

const bootstrap = window.__GLIXO_SANDBOXED_WEB__;
let sequence = 0;
let requestSequence = 0;
const pending = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
const themeListeners = new Set<(tokens: GlixoTheme) => void>();
let theme: GlixoTheme = {};

function validEnvelope(value: unknown): value is BridgeEnvelope {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const message = value as Partial<BridgeEnvelope>;
    return message.contractKind === 'sandboxed-web-bridge'
        && message.protocol === 'glixo.sandboxed-web.bridge'
        && message.schema === 1
        && message.instanceNonce === bootstrap?.instanceNonce
        && Number.isInteger(message.sequence)
        && (message.kind === 'response' || message.kind === 'error' || message.kind === 'event');
}

function receive(event: MessageEvent<unknown>): void {
    if (!bootstrap || event.source !== window.parent || event.origin !== 'null' || !validEnvelope(event.data)) return;
    const message = event.data;
    if (message.kind === 'event' && message.operation === 'host.theme') {
        theme = normalizeTheme(message.payload?.tokens ?? message.payload);
        themeListeners.forEach(listener => listener(theme));
        return;
    }
    if ((message.kind === 'response' || message.kind === 'error') && message.requestId) {
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        if (message.kind === 'error') request.reject(new Error(message.error?.code ?? 'bridge_request_failed'));
        else request.resolve(message.payload ?? {});
    }
}

window.addEventListener('message', receive);

function request(operation: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!bootstrap || window.parent === window) return Promise.reject(new Error('sandbox_bridge_unavailable'));
    if (pending.size >= 8) return Promise.reject(new Error('bridge_request_limit'));
    const requestId = `req.${Date.now().toString(36)}_${(++requestSequence).toString(36)}`;
    sequence += 1;
    return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        const message: BridgeEnvelope = {
            contractKind: 'sandboxed-web-bridge', protocol: bootstrap.protocol, schema: bootstrap.schema,
            kind: 'request', instanceNonce: bootstrap.instanceNonce, sequence, requestId, operation, payload,
        };
        window.parent.postMessage(message, '*');
        window.setTimeout(() => {
            const outstanding = pending.get(requestId);
            if (!outstanding) return;
            pending.delete(requestId);
            outstanding.reject(new Error('bridge_request_timeout'));
        }, 5000);
    });
}

function announceReady(): void {
    if (!bootstrap || window.parent === window) return;
    sequence += 1;
    const message: BridgeEnvelope = {
        contractKind: 'sandboxed-web-bridge', protocol: bootstrap.protocol, schema: bootstrap.schema,
        kind: 'event', instanceNonce: bootstrap.instanceNonce, sequence, operation: 'guest.ready',
    };
    window.parent.postMessage(message, '*');
}

export function currentTheme(): GlixoTheme { return theme; }

function normalizeTheme(value: unknown): GlixoTheme {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const source = value as Record<string, unknown>;
    const aliases: Readonly<Record<string, keyof GlixoThemeTokens>> = {
        'color.bg': 'background', 'color.background': 'background', 'color.panel': 'panel',
        'color.surface': 'surface', 'color.text': 'text', 'color.muted': 'muted',
        'color.accent': 'accent', 'color.border': 'border', 'color.danger': 'danger',
        'color.warning': 'warning', 'color.success': 'success', 'font.family': 'fontFamily',
        'control.radius': 'radius', 'space.scale': 'spacing',
    };
    const normalized: Partial<GlixoThemeTokens> = {};
    for (const [key, item] of Object.entries(source)) {
        const target = aliases[key] ?? (key in TOKEN_NAMES ? key as keyof GlixoThemeTokens : undefined);
        if (target && typeof item === 'string') Object.assign(normalized, { [target]: item });
    }
    return normalized;
}

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

export function connectTheme(root: HTMLElement = document.documentElement): () => void {
    const unsubscribe = subscribeTheme(tokens => applyTheme(tokens, root));
    announceReady();
    void request('lifecycle.ready').then(() => request('theme.tokens')).then(result => {
        const tokens = normalizeTheme(result.tokens);
        theme = tokens;
        themeListeners.forEach(listener => listener(theme));
    }).catch(() => undefined);
    return unsubscribe;
}

export async function invoke(actionId: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!/^[a-z0-9][a-z0-9.-]{1,127}$/.test(actionId)) throw new Error('action_id_invalid');
    return request('action.invoke', { id: actionId, params: payload });
}
