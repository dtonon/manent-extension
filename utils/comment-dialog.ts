import { ICON_PATHS } from './icons';

export type DialogPreview = { srcUrl: string; screenshot?: boolean } | { quote: string };

interface DialogOptions {
  preview: DialogPreview;
  icons: { close: string; send: string };
}

// Runs in the page, so it must be self-contained: no imports, no closures
function showCommentDialog(opts: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const HOST_ID = 'manent-dialog-host';
    document.getElementById(HOST_ID)?.remove();
    const previousFocus = document.activeElement as HTMLElement | null;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    const css = `
      :host { all: initial; }
      .scrim { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px;
        background: rgba(0,0,0,.45); }
      .dialog {
        --card: #ffffff; --card-dim: #eeeeee; --text: rgba(0,0,0,.867); --text-2: #757575;
        --hint: #9e9e9e; --icon: #9e9e9e; --accent: #e32a6d;
        box-sizing: border-box; width: 100%; max-width: 420px; border-radius: 16px; overflow: hidden;
        background: var(--card); color: var(--text); box-shadow: 0 12px 40px rgba(0,0,0,.4);
        font: 14px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      @media (prefers-color-scheme: dark) {
        .dialog { --card: #1e1e1e; --card-dim: #2a2a2a; --text: rgba(255,255,255,.871);
          --text-2: #a8a8a8; --hint: #7a7a7a; --icon: #9a9a9a; }
      }
      .hd { display: flex; align-items: center; gap: 8px; padding: 16px 16px 0 24px; }
      h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 500; }
      button { display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0;
        border-radius: 50%; background: none; cursor: pointer; }
      .close { color: var(--icon); }
      .send { color: var(--accent); }
      button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .pending { display: flex; align-items: center; gap: 10px; padding: 14px 24px 0; }
      .thumb { width: 36px; height: 36px; border-radius: 4px; object-fit: cover; background: var(--card-dim);
        flex: none; }
      .name { min-width: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .quote { margin: 14px 24px 0; padding: 2px 0 2px 10px; border-left: 3px solid var(--accent);
        color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 7.8em; overflow: auto; }
      .row { display: flex; align-items: flex-end; gap: 8px; padding: 10px 16px 14px 24px; }
      textarea { box-sizing: border-box; flex: 1; min-height: 40px; max-height: 200px; padding: 10px 0; border: 0; border-radius: 4px;
        background: none; color: var(--text); font: inherit; resize: none; }
      textarea:focus { outline: none; }
      textarea::placeholder { color: var(--hint); }
      .hint { padding: 0 24px 14px; color: var(--text-2); font-size: 12px; }
      svg { display: block; }
    `;
    if ('adoptedStyleSheets' in shadow) {
      // Constructed sheets are not blocked by the page CSP
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement('style');
      style.textContent = css;
      (shadow as ShadowRoot).appendChild(style);
    }

    const make = (tag: string, cls?: string, text?: string) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text) el.textContent = text;
      return el;
    };
    const svg = (path: string) => {
      const ns = 'http://www.w3.org/2000/svg';
      const el = document.createElementNS(ns, 'svg');
      el.setAttribute('width', '24');
      el.setAttribute('height', '24');
      el.setAttribute('viewBox', '0 0 24 24');
      el.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', path);
      p.setAttribute('fill', 'currentColor');
      el.appendChild(p);
      return el;
    };

    const isImage = 'srcUrl' in opts.preview;
    const isScreenshot = 'srcUrl' in opts.preview && Boolean(opts.preview.screenshot);
    const noun = isScreenshot ? 'screenshot' : isImage ? 'image' : 'selection';

    const scrim = make('div', 'scrim');
    const dialog = make('div', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'manent-dialog-title');

    const hd = make('div', 'hd');
    const title = make('h2', '', `Save ${noun} to Manent`);
    title.id = 'manent-dialog-title';
    const close = make('button', 'close') as HTMLButtonElement;
    close.type = 'button';
    close.setAttribute('aria-label', 'Cancel');
    close.appendChild(svg(opts.icons.close));
    hd.append(title, close);

    let pending: HTMLElement;
    if ('srcUrl' in opts.preview) {
      let filename = isScreenshot ? 'Screenshot' : 'Image';
      if (!isScreenshot) {
        try {
          const last = new URL(opts.preview.srcUrl).pathname.split('/').filter(Boolean).pop();
          if (last) filename = decodeURIComponent(last);
        } catch {
          // Data URLs and similar keep the generic name
        }
      }
      pending = make('div', 'pending');
      const thumb = make('img', 'thumb') as HTMLImageElement;
      thumb.src = opts.preview.srcUrl;
      thumb.alt = '';
      // The page CSP may block data URLs
      thumb.addEventListener('error', () => (thumb.style.visibility = 'hidden'));
      pending.append(thumb, make('span', 'name', filename));
    } else {
      pending = make('blockquote', 'quote', opts.preview.quote);
      pending.setAttribute('aria-label', 'Selected text');
    }

    const row = make('div', 'row');
    const field = make('textarea') as HTMLTextAreaElement;
    field.rows = 1;
    field.placeholder = isImage ? 'Add a caption...' : 'Add a comment...';
    field.setAttribute('aria-label', isImage ? 'Caption' : 'Comment');
    field.setAttribute('aria-describedby', 'manent-dialog-hint');
    const send = make('button', 'send') as HTMLButtonElement;
    send.type = 'button';
    send.setAttribute('aria-label', `Save ${noun}`);
    send.appendChild(svg(opts.icons.send));
    row.append(field, send);

    const hint = make('div', 'hint', 'Enter to save, Shift+Enter for a new line, Esc to cancel');
    hint.id = 'manent-dialog-hint';

    dialog.append(hd, pending, row, hint);
    scrim.appendChild(dialog);
    shadow.appendChild(scrim);
    document.documentElement.appendChild(host);

    const finish = (value: string | null) => {
      host.remove();
      previousFocus?.focus?.();
      resolve(value);
    };
    const grow = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
    };

    field.addEventListener('input', grow);
    close.addEventListener('click', () => finish(null));
    send.addEventListener('click', () => finish(field.value));
    scrim.addEventListener('mousedown', (e) => {
      if (e.target === scrim) finish(null);
    });
    dialog.addEventListener('keydown', (e) => {
      // Keep keys away from the page's own shortcuts
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter' && !e.shiftKey && e.target === field) {
        e.preventDefault();
        finish(field.value);
      } else if (e.key === 'Tab') {
        const order = [close, field, send];
        const i = order.indexOf(shadow.activeElement as any);
        const next = e.shiftKey ? (i <= 0 ? order.length - 1 : i - 1) : (i + 1) % order.length;
        e.preventDefault();
        order[next].focus();
      }
    });
    field.focus();
  });
}

export async function askComment(tabId: number, preview: DialogPreview): Promise<string | null> {
  const { close, send } = ICON_PATHS;
  const [injection] = await browser.scripting
    .executeScript({
      target: { tabId },
      func: showCommentDialog,
      args: [{ preview, icons: { close, send } }],
    })
    .catch(() => [undefined]);
  return (injection?.result ?? null) as string | null;
}
