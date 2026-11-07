// Talk to the JobBid extension running in this same browser. Its content script listens on this page
// (window.postMessage), so the dashboard can ask for things only the extension can do.
type Reply = { ok: boolean; error?: string; [k: string]: any };
let seq = 0;

function send(action: string, timeoutMs: number): Promise<Reply | null> {
  const id = `m${Date.now()}-${seq++}`;
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== 'jobbid-ext' || e.data.id !== id) return;
      done(e.data);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    const done = (r: Reply | null) => { clearTimeout(timer); removeEventListener('message', onMsg); resolve(r); };
    addEventListener('message', onMsg);
    window.postMessage({ source: 'jobbid-hub', id, action }, location.origin);
  });
}

export async function askExtension(action: string, timeoutMs = 150_000): Promise<Reply> {
  // Quick check first, so a missing extension doesn't mean a long wait.
  const ping = await send('ping', 1500);
  if (!ping) return { ok: false, error: 'The JobBid extension is not in this browser. Open this dashboard in the Chrome where JobBid is installed, then reload the page.' };
  return (await send(action, timeoutMs)) || { ok: false, error: 'The extension did not answer in time.' };
}
