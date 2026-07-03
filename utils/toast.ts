export type ToastState = 'loading' | 'success' | 'error';

function renderToast(state: string, message: string) {
  const ID = 'manent-toast';
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ID;
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:2147483647;background:#333;color:#fff;' +
      'padding:10px 14px;border-radius:6px;font:13px sans-serif;display:flex;align-items:center;' +
      'gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    const style = document.createElement('style');
    style.textContent = '@keyframes manent-spin{to{transform:rotate(360deg)}}';
    el.appendChild(style);
    const spin = document.createElement('span');
    spin.id = ID + '-spin';
    spin.style.cssText =
      'width:12px;height:12px;border:2px solid #fff;border-top-color:transparent;' +
      'border-radius:50%;display:inline-block;animation:manent-spin 1s linear infinite';
    el.appendChild(spin);
    const text = document.createElement('span');
    text.id = ID + '-text';
    el.appendChild(text);
    document.documentElement.appendChild(el);
  }
  document.getElementById(ID + '-spin')!.style.display =
    state === 'loading' ? 'inline-block' : 'none';
  document.getElementById(ID + '-text')!.textContent = message;
  const w = window as any;
  clearTimeout(w.__manentToastTimer);
  if (state !== 'loading') {
    w.__manentToastTimer = setTimeout(() => document.getElementById(ID)?.remove(), 3000);
  }
}

export async function showPageToast(
  tabId: number,
  state: ToastState,
  message: string,
): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: renderToast,
      args: [state, message],
    });
  } catch {
    // Restricted pages, the badge remains the only feedback
  }
}
