import { ICON_PATHS } from './icons';
import { MANENT_URL } from './manent';

export type ToastState = 'loading' | 'published' | 'queued' | 'error';

interface ToastOptions {
  state: ToastState;
  message: string;
  detail?: string;
  icons: { check: string; schedule: string; syncProblem: string; close: string };
  manentUrl: string;
}

// Runs in the page, so it must be self-contained: no imports, no closures
function renderToast(opts: ToastOptions) {
  const HOST_ID = 'manent-toast-host';
  const w = window as any;
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    const css = `
      :host { all: initial; }
      .toast {
        --card: #ffffff; --text: rgba(0,0,0,.867); --text-2: #757575; --accent: #e32a6d; --icon: #9e9e9e;
        box-sizing: border-box; width: 300px; padding: 12px 14px 8px; border-radius: 8px;
        background: var(--card); color: var(--text); box-shadow: 0 6px 24px rgba(0,0,0,.22);
        font: 14px/1.3 Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      @media (prefers-color-scheme: dark) {
        .toast { --card: #1e1e1e; --text: rgba(255,255,255,.871); --text-2: #a8a8a8; --icon: #9a9a9a;
          box-shadow: 0 6px 24px rgba(0,0,0,.6); }
      }
      .hd { display: flex; align-items: center; gap: 8px; font-weight: 500; }
      .dot { width: 20px; height: 20px; border-radius: 50%; background: var(--accent); color: #fff;
        display: grid; place-items: center; font-size: 10px; font-weight: 700; flex: none; }
      .title { flex: 1; min-width: 0; }
      .spin { width: 14px; height: 14px; border: 2px solid var(--accent); border-top-color: transparent;
        border-radius: 50%; animation: spin 1s linear infinite; flex: none; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }
      .close { display: grid; place-items: center; width: 24px; height: 24px; margin: -4px -6px -4px 0;
        padding: 0; border: 0; border-radius: 4px; background: none; color: var(--icon); cursor: pointer; }
      .close:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .detail { margin-top: 6px; color: var(--text-2); font-size: 13px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .error .detail { white-space: normal; }
      .foot { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 6px;
        color: var(--text-2); font-size: 12px; }
      .foot a { margin-right: auto; color: var(--accent); font-size: 13px; font-weight: 500; }
      .foot .fail { color: var(--accent); }
      svg { display: block; flex: none; }
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
    document.documentElement.appendChild(host);
  }

  const shadow = host.shadowRoot!;
  shadow.querySelector('.toast')?.remove();
  const svg = (path: string, size: number) => {
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, 'svg');
    el.setAttribute('width', String(size));
    el.setAttribute('height', String(size));
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'currentColor');
    el.appendChild(p);
    return el;
  };
  const make = (tag: string, cls?: string, text?: string) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  };
  const remove = () => {
    clearTimeout(w.__manentToastTimer);
    document.getElementById(HOST_ID)?.remove();
  };

  const toast = make('div', `toast ${opts.state}`);
  toast.setAttribute('role', opts.state === 'error' ? 'alert' : 'status');
  const hd = make('div', 'hd');
  const dot = make('span', 'dot', 'M');
  dot.setAttribute('aria-hidden', 'true');
  hd.append(dot, make('span', 'title', opts.message));
  if (opts.state === 'loading') {
    hd.appendChild(make('span', 'spin'));
  } else {
    const close = make('button', 'close') as HTMLButtonElement;
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.appendChild(svg(opts.icons.close, 18));
    close.addEventListener('click', remove);
    hd.appendChild(close);
  }
  toast.appendChild(hd);
  if (opts.detail) toast.appendChild(make('div', 'detail', opts.detail));

  if (opts.state !== 'loading') {
    const foot = make('div', 'foot');
    if (opts.state === 'published') {
      const link = make('a', '', 'Open') as HTMLAnchorElement;
      link.href = opts.manentUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.setAttribute('aria-label', 'Open Manent');
      foot.appendChild(link);
    }
    const icon =
      opts.state === 'published'
        ? opts.icons.check
        : opts.state === 'queued'
          ? opts.icons.schedule
          : opts.icons.syncProblem;
    const iconEl = svg(icon, 14);
    if (opts.state === 'error') iconEl.setAttribute('class', 'fail');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    foot.append(iconEl, make('span', '', time));
    toast.appendChild(foot);
  }
  shadow.appendChild(toast);

  clearTimeout(w.__manentToastTimer);
  // Errors stay until closed, so the message can be read
  if (opts.state === 'published' || opts.state === 'queued') {
    w.__manentToastTimer = setTimeout(remove, 4000);
  }
}

export async function showPageToast(
  tabId: number,
  state: ToastState,
  message: string,
  detail?: string,
): Promise<void> {
  const { check, schedule, syncProblem, close } = ICON_PATHS;
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: renderToast,
      args: [
        { state, message, detail, icons: { check, schedule, syncProblem, close }, manentUrl: MANENT_URL },
      ],
    });
  } catch {
    // Restricted pages, the badge remains the only feedback
  }
}
