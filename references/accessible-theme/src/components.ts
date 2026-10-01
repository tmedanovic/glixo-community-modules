const COMMON_CSS = `
:host{display:inline-block;color:var(--glixo-color-text,#edf1f7);font:inherit}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--glixo-color-accent,#3b82f6);outline-offset:2px}
`;

abstract class GlixoElement extends HTMLElement {
    protected readonly root: ShadowRoot;

    constructor() {
        super();
        this.root = this.attachShadow({ mode: 'open' });
    }

    protected mount(css: string, content: string): void {
        const style = document.createElement('style');
        style.nonce = window.glixoExtension?.styleNonce ?? '';
        style.textContent = COMMON_CSS + css;
        this.root.replaceChildren(style, document.createRange().createContextualFragment(content));
    }
}

export class GlixoButton extends GlixoElement {
    static observedAttributes = ['disabled', 'variant', 'type'];
    connectedCallback(): void { this.render(); }
    attributeChangedCallback(): void { if (this.isConnected) this.render(); }
    private render(): void {
        const variant = ['primary', 'quiet', 'danger'].includes(this.getAttribute('variant') ?? '') ? this.getAttribute('variant') : 'quiet';
        this.mount(`
          button{min-height:34px;padding:6px 12px;border:1px solid var(--glixo-color-border,#ffffff20);border-radius:var(--glixo-radius-control,8px);background:var(--glixo-color-surface,#1e2229);cursor:pointer}
          button[data-variant=primary]{background:var(--glixo-color-accent,#3b82f6);border-color:transparent;color:white}
          button[data-variant=danger]{color:var(--glixo-color-danger,#ef5a5a)}
          button:disabled{opacity:.55;cursor:not-allowed}
        `, `<button part="button" type="${escapeAttr(this.getAttribute('type') ?? 'button')}" data-variant="${variant}" ${this.hasAttribute('disabled') ? 'disabled' : ''}><slot></slot></button>`);
    }
}

export class GlixoTextField extends GlixoElement {
    static observedAttributes = ['label', 'value', 'placeholder', 'disabled', 'required', 'autocomplete'];
    connectedCallback(): void { this.render(); }
    attributeChangedCallback(): void { if (this.isConnected) this.render(); }
    get value(): string { return this.root.querySelector('input')?.value ?? ''; }
    set value(value: string) { const input = this.root.querySelector('input'); if (input) input.value = value; }
    private render(): void {
        const id = `field-${crypto.randomUUID()}`;
        this.mount(`
          label{display:grid;gap:5px;color:var(--glixo-color-muted,#a4adbb);font-size:12px}
          input{width:100%;min-height:36px;padding:7px 9px;border:1px solid var(--glixo-color-border,#ffffff20);border-radius:var(--glixo-radius-control,8px);background:var(--glixo-color-panel,#191c21)}
        `, `<label for="${id}">${escapeText(this.getAttribute('label') ?? '')}<input id="${id}" type="text" value="${escapeAttr(this.getAttribute('value') ?? '')}" placeholder="${escapeAttr(this.getAttribute('placeholder') ?? '')}" autocomplete="${escapeAttr(this.getAttribute('autocomplete') ?? 'off')}" ${this.hasAttribute('required') ? 'required' : ''} ${this.hasAttribute('disabled') ? 'disabled' : ''}></label>`);
        this.root.querySelector('input')?.addEventListener('input', event => this.dispatchEvent(new CustomEvent('glixo-input', { detail: { value: (event.currentTarget as HTMLInputElement).value }, bubbles: true, composed: true })));
    }
}

export class GlixoSwitch extends GlixoElement {
    static observedAttributes = ['checked', 'disabled', 'label'];
    connectedCallback(): void { this.render(); }
    attributeChangedCallback(): void { if (this.isConnected) this.render(); }
    get checked(): boolean { return this.hasAttribute('checked'); }
    set checked(value: boolean) { this.toggleAttribute('checked', value); }
    private render(): void {
        const checked = this.hasAttribute('checked');
        this.mount(`
          button{display:inline-flex;align-items:center;gap:9px;padding:0;border:0;background:transparent;cursor:pointer;color:var(--glixo-color-text,#edf1f7)}
          i{width:34px;height:20px;padding:2px;border-radius:99px;background:var(--glixo-color-border,#ffffff20);transition:background .12s}
          i:after{content:"";display:block;width:16px;height:16px;border-radius:50%;background:white;transition:transform .12s}
          button[aria-checked=true] i{background:var(--glixo-color-accent,#3b82f6)} button[aria-checked=true] i:after{transform:translateX(14px)}
          button:disabled{opacity:.55;cursor:not-allowed}
        `, `<button part="switch" type="button" role="switch" aria-checked="${checked}" aria-label="${escapeAttr(this.getAttribute('label') ?? '')}" ${this.hasAttribute('disabled') ? 'disabled' : ''}><i aria-hidden="true"></i><slot>${escapeText(this.getAttribute('label') ?? '')}</slot></button>`);
        this.root.querySelector('button')?.addEventListener('click', () => {
            if (this.hasAttribute('disabled')) return;
            this.checked = !checked;
            this.dispatchEvent(new CustomEvent('change', { detail: { checked: this.checked }, bubbles: true, composed: true }));
        });
    }
}

export class GlixoBadge extends GlixoElement {
    connectedCallback(): void { this.mount(`span{display:inline-flex;padding:2px 7px;border:1px solid var(--glixo-color-border,#ffffff20);border-radius:99px;color:var(--glixo-color-muted,#a4adbb);font-size:11px;line-height:18px}`, '<span part="badge"><slot></slot></span>'); }
}

export class GlixoCard extends GlixoElement {
    connectedCallback(): void { this.mount(`section{display:block;padding:14px;border:1px solid var(--glixo-color-border,#ffffff20);border-radius:var(--glixo-radius-control,8px);background:var(--glixo-color-panel,#191c21)}`, '<section part="card"><slot></slot></section>'); }
}

export class GlixoNotice extends GlixoElement {
    static observedAttributes = ['tone'];
    connectedCallback(): void { this.render(); }
    attributeChangedCallback(): void { if (this.isConnected) this.render(); }
    private render(): void {
        const tone = this.getAttribute('tone') === 'error' ? 'error' : this.getAttribute('tone') === 'warning' ? 'warning' : 'info';
        this.mount(`div{padding:10px 12px;border:1px solid var(--glixo-color-border,#ffffff20);border-radius:var(--glixo-radius-control,8px);background:var(--glixo-color-panel,#191c21)}div[data-tone=error]{border-color:var(--glixo-color-danger,#ef5a5a)}div[data-tone=warning]{border-color:var(--glixo-color-warning,#e0a458)}`, `<div part="notice" role="${tone === 'error' ? 'alert' : 'status'}" data-tone="${tone}"><slot></slot></div>`);
    }
}

export class GlixoProgress extends GlixoElement {
    static observedAttributes = ['value', 'max', 'label'];
    connectedCallback(): void { this.render(); }
    attributeChangedCallback(): void { if (this.isConnected) this.render(); }
    private render(): void {
        const max = finitePositive(this.getAttribute('max'), 100);
        const value = Math.min(max, Math.max(0, finitePositive(this.getAttribute('value'), 0)));
        this.mount(`progress{display:block;width:100%;height:6px;border:0;border-radius:99px;overflow:hidden;background:var(--glixo-color-border,#ffffff20);appearance:none}progress::-webkit-progress-bar{background:var(--glixo-color-border,#ffffff20)}progress::-webkit-progress-value{background:var(--glixo-color-accent,#3b82f6)}progress::-moz-progress-bar{background:var(--glixo-color-accent,#3b82f6)}`, `<progress part="progress" aria-label="${escapeAttr(this.getAttribute('label') ?? 'Progress')}" max="${max}" value="${value}"></progress>`);
    }
}

export class GlixoSelect extends GlixoElement {
    static observedAttributes = ['label', 'value', 'disabled'];
    options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }> = [];
    connectedCallback(): void { this.render(); }
    attributeChangedCallback(): void { if (this.isConnected) this.render(); }
    get value(): string { return this.root.querySelector('select')?.value ?? ''; }
    set value(value: string) { const select = this.root.querySelector('select'); if (select) select.value = value; }
    private render(): void {
        const id = `select-${crypto.randomUUID()}`;
        const options = this.options.map(item => `<option value="${escapeAttr(item.value)}" ${item.disabled ? 'disabled' : ''}>${escapeText(item.label)}</option>`).join('');
        this.mount(`label{display:grid;gap:5px;color:var(--glixo-color-muted,#a4adbb);font-size:12px}select{min-height:36px;padding:7px 9px;border:1px solid var(--glixo-color-border,#ffffff20);border-radius:var(--glixo-radius-control,8px);background:var(--glixo-color-panel,#191c21)}`, `<label for="${id}">${escapeText(this.getAttribute('label') ?? '')}<select id="${id}" ${this.hasAttribute('disabled') ? 'disabled' : ''}>${options}</select></label>`);
        const select = this.root.querySelector('select');
        if (select) {
            select.value = this.getAttribute('value') ?? '';
            select.addEventListener('change', () => this.dispatchEvent(new CustomEvent('change', { detail: { value: select.value }, bubbles: true, composed: true })));
        }
    }
}

export class GlixoDialog extends GlixoElement {
    static observedAttributes = ['open', 'label'];
    connectedCallback(): void { this.render(); }
    attributeChangedCallback(): void { if (this.isConnected) this.render(); }
    private render(): void {
        const open = this.hasAttribute('open');
        const dialogId = `dialog-${crypto.randomUUID()}`;
        this.mount(`div[hidden]{display:none!important}div{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(0,0,0,.5)}section{width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:18px;border:1px solid var(--glixo-color-border,#ffffff20);border-radius:var(--glixo-radius-control,8px);background:var(--glixo-color-panel,#191c21);box-shadow:0 16px 40px #0008}`, `<div ${open ? '' : 'hidden'}><section part="dialog" role="dialog" aria-modal="true" aria-label="${escapeAttr(this.getAttribute('label') ?? 'Extension dialog')}" id="${dialogId}"><slot></slot></section></div>`);
    }
    show(): void { this.setAttribute('open', ''); }
    close(): void { this.removeAttribute('open'); }
}

const ELEMENTS: ReadonlyArray<readonly [string, CustomElementConstructor]> = [
    ['glixo-button', GlixoButton], ['glixo-text-field', GlixoTextField], ['glixo-switch', GlixoSwitch],
    ['glixo-badge', GlixoBadge], ['glixo-card', GlixoCard], ['glixo-notice', GlixoNotice],
    ['glixo-progress', GlixoProgress], ['glixo-select', GlixoSelect], ['glixo-dialog', GlixoDialog],
];

export function registerGlixoElements(registry: CustomElementRegistry = customElements): void {
    for (const [name, constructor] of ELEMENTS) if (!registry.get(name)) registry.define(name, constructor);
}

function escapeText(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character)); }
function escapeAttr(value: string): string { return escapeText(value).replace(/`/g, '&#96;'); }
function finitePositive(value: string | null, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }
