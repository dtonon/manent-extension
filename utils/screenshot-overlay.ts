export interface SelectedArea {
  x: number;
  y: number;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
}

// Runs in the page, so it must be self-contained: no imports, no closures
function selectArea(): Promise<SelectedArea | null> {
  return new Promise((resolve) => {
    const HOST_ID = 'manent-area-host';
    const MIN_SIZE = 8;
    document.getElementById(HOST_ID)?.remove();
    const previousFocus = document.activeElement as HTMLElement | null;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    const css = `
      :host { all: initial; }
      .layer { position: fixed; inset: 0; cursor: crosshair; touch-action: none; outline: none;
        background: rgba(0,0,0,.45); user-select: none; -webkit-user-select: none; }
      .layer.dragging { background: none; }
      .area { position: fixed; display: none; box-sizing: border-box; border: 1px solid #ffffff;
        outline: 1px dashed #e32a6d; box-shadow: 0 0 0 100vmax rgba(0,0,0,.45); }
      .hint, .size { position: fixed; box-sizing: border-box; background: #1e1e1e; color: #ffffff;
        font: 13px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased; pointer-events: none; }
      .hint { top: 16px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px);
        padding: 8px 14px; border-radius: 8px; text-align: center; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
      .size { display: none; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
      .guide { position: fixed; top: 0; left: 0; display: none; pointer-events: none;
        background: rgba(255,255,255,.9); box-shadow: 0 0 0 1px rgba(0,0,0,.35); }
      .guide-x { width: 100vw; height: 1px; }
      .guide-y { width: 1px; height: 100vh; }
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

    const make = (cls: string, text?: string) => {
      const el = document.createElement('div');
      el.className = cls;
      if (text) el.textContent = text;
      return el;
    };
    const layer = make('layer');
    layer.tabIndex = 0;
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'Select an area to save to Manent');
    layer.setAttribute('aria-describedby', 'manent-area-hint');
    const area = make('area');
    const size = make('size');
    size.setAttribute('aria-hidden', 'true');
    const guideX = make('guide guide-x');
    const guideY = make('guide guide-y');
    const hint = make('hint', 'Drag to select an area · Enter for the whole view · Esc to cancel');
    hint.id = 'manent-area-hint';
    layer.append(area, guideX, guideY, size, hint);
    shadow.appendChild(layer);
    document.documentElement.appendChild(host);

    const full = (): SelectedArea => ({
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      viewWidth: window.innerWidth,
      viewHeight: window.innerHeight,
    });
    const finish = (value: SelectedArea | null) => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', onHidden);
      host.remove();
      previousFocus?.focus?.({ preventScroll: true });
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      // Keep keys away from the page's own shortcuts
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(full());
      }
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') finish(null);
    };

    let start: { x: number; y: number } | null = null;
    let box = { x: 0, y: 0, width: 0, height: 0 };
    const draw = (x: number, y: number) => {
      const s = start!;
      box = {
        x: Math.min(s.x, x),
        y: Math.min(s.y, y),
        width: Math.abs(x - s.x),
        height: Math.abs(y - s.y),
      };
      Object.assign(area.style, {
        display: 'block',
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });
      size.textContent = `${Math.round(box.width)} × ${Math.round(box.height)}`;
      size.style.display = 'block';
      const below = box.y + box.height + 28 < window.innerHeight;
      size.style.left = `${Math.min(box.x, window.innerWidth - size.offsetWidth - 4)}px`;
      size.style.top = below ? `${box.y + box.height + 6}px` : `${Math.max(4, box.y - 26)}px`;
    };

    layer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
    });
    // Guides through the pointer, to place the corners precisely
    const showGuides = (x: number, y: number) => {
      guideX.style.display = guideY.style.display = 'block';
      guideX.style.transform = `translateY(${y}px)`;
      guideY.style.transform = `translateX(${x}px)`;
    };
    layer.addEventListener('pointerleave', () => {
      guideX.style.display = guideY.style.display = 'none';
    });
    layer.addEventListener('pointermove', (e) => {
      showGuides(e.clientX, e.clientY);
      if (!start) return;
      layer.classList.add('dragging');
      hint.style.display = 'none';
      draw(e.clientX, e.clientY);
    });
    layer.addEventListener('pointerup', (e) => {
      if (!start) return;
      draw(e.clientX, e.clientY);
      // A click without a real drag takes the whole view
      if (box.width < MIN_SIZE || box.height < MIN_SIZE) finish(full());
      else finish({ ...box, viewWidth: window.innerWidth, viewHeight: window.innerHeight });
    });
    layer.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onHidden);
    layer.focus({ preventScroll: true });
  });
}

// Null when the user cancels
export async function askArea(tabId: number): Promise<SelectedArea | null> {
  const [injection] = await browser.scripting.executeScript({ target: { tabId }, func: selectArea });
  return (injection?.result ?? null) as SelectedArea | null;
}
