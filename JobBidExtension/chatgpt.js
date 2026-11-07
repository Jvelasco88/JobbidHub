// JobBid on chatgpt.com: when the "ChatGPT website" AI mode is on, the background worker uses this
// script to type a question into ChatGPT and read the answer. Every request is short and stateless
// ("send this", "what does the page show now?"), so nothing breaks if a message channel closes or the
// page re-renders while ChatGPT is answering. Only acts in the tab JobBid opened for this.
(() => {
  // After the extension is reloaded, the old copy of this script is cut off and can't answer any more:
  // only a copy that still works blocks a new one.
  if (window.__jobbidChatgptAlive?.()) return;
  window.__jobbidChatgptAlive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const visible = (el) => !!el && el.getClientRects().length > 0;

  // The message box at the bottom - never an editable box inside an answer (ChatGPT's "Writing" blocks
  // can be edited too).
  const inAnswer = (el) => !!el.closest('[data-message-author-role], article, [data-testid^="conversation-turn"]');
  const composer = () => $('#prompt-textarea') || $('div[contenteditable="true"][id*="prompt"]') || $('form textarea')
    || [...document.querySelectorAll('form div.ProseMirror[contenteditable="true"], div.ProseMirror[contenteditable="true"]')].find((el) => !inAnswer(el)) || null;
  const sendButton = () => $('[data-testid="send-button"]') || $('#composer-submit-button') || $('button[aria-label="Send prompt"]') || $('button[aria-label*="Send" i]');
  const stopButton = () => $('[data-testid="stop-button"]') || $('button[aria-label="Stop streaming"]') || $('button[aria-label="Stop generating"]')
    || $('button[data-testid*="stop-button" i]') || $('#composer-submit-button[aria-label^="Stop" i]') || $('button[aria-label*="Stop streaming" i]') || $('button[aria-label^="Stop response" i]');
  // ChatGPT changes its page often, so answers are found several ways.
  function answers() {
    let list = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (!list.length) list = [...document.querySelectorAll('article[data-testid^="conversation-turn"]')].filter((a) => a.querySelector('.markdown, [class*="markdown"]'));
    if (!list.length) list = [...document.querySelectorAll('.markdown, div[class*="markdown"]')].filter((m) => !m.parentElement?.closest('.markdown, div[class*="markdown"]'));
    return list;
  }
  // The question we sent last, to find the answer by position if nothing else works.
  let lastPrompt = '';

  // Signed out, rate-limited or blocked: say so instead of waiting forever.
  function pageProblem() {
    const text = document.body?.innerText || '';
    if (/you['’]ve (hit|reached) (your|the) .{0,40}limit|usage cap|too many requests/i.test(text)) return 'ChatGPT says you reached your message limit. Try again later.';
    if (/verify you are human|checking your browser|just a moment/i.test(text) && !composer()) return 'ChatGPT is asking to verify you are human. Open the ChatGPT tab and complete the check.';
    if (!composer() && ($('[data-testid="login-button"]') || /log in|sign up/i.test(text.slice(0, 2000)))) return 'Not signed in to ChatGPT. Open chatgpt.com in this Chrome and sign in.';
    return '';
  }

  // This tab is in the background, where Chrome makes every timer wait about a second. A message to
  // ourselves is not slowed down, and it also lets the page's own updates (the Send button turning on)
  // run in between.
  const tick = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

  // Waits without timers for the first seconds: Chrome slows timers in background tabs (after a few
  // minutes hidden, to about once a minute), and this tab is always in the background. A message to
  // ourselves is never slowed down. Longer waits fall back to a timer.
  async function waitFor(fn, ms, step = 200) {
    const start = Date.now();
    const end = start + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await (Date.now() - start < 3000 ? tick() : sleep(step));
    }
  }

  // Put text into the ChatGPT message box. Typing (insertText) goes exactly where the cursor is; a paste
  // event is only the fallback, because an open "Writing" answer catches pastes meant for the message box.
  async function typeInto(box, text) {
    box.focus();
    if (box.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // Put the cursor inside the message box first: in a background tab focus() alone may leave it in
    // another editable box (an earlier "Writing" answer), and the text would land there.
    const selectBox = () => {
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
    selectBox();
    document.execCommand('insertText', false, text);
    if (!(await waitFor(() => sameStart(box.innerText, text), 200))) {
      selectBox();
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await waitFor(() => sameStart(box.innerText, text), 200);
    }
  }
  const sameStart = (a, b) => (a || '').replace(/\s+/g, ' ').trim().slice(0, 40) === (b || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  // Type and send. Returns how many answers were on the page before, so the reader knows which one is new.
  async function sendPrompt(prompt) {
    const box = await waitFor(() => (visible(composer()) ? composer() : null) || (pageProblem() ? 'problem' : null), 8000);
    if (!box || box === 'problem') throw new Error(pageProblem() || 'The ChatGPT page is not ready.');
    const before = answers().length;
    lastPrompt = prompt;
    await typeInto(box, prompt);
    const typed = box.tagName === 'TEXTAREA' ? box.value : box.innerText;
    if (!sameStart(typed, prompt)) throw new Error('could not type into the ChatGPT message box. Click into the ChatGPT tab once and try again.');
    const btn = await waitFor(() => { const b = sendButton(); return b && !b.disabled ? b : null; }, 6000);
    if (btn) btn.click();
    else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return before;
  }

  // Last resort: the page text after our question (works with any layout).
  function textAfterPrompt() {
    if (!lastPrompt) return '';
    // The turns after our question. A long question is folded ("… Show more"), so its last line
    // is not on the page and matching text would land on an earlier question instead.
    const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
    const lastUser = users[users.length - 1];
    const isOurs = lastUser && squash(lastUser.innerText).includes(squash(lastPrompt).slice(0, 60));
    if (lastUser && (isOurs || askedShown())) {
      const turn = lastUser.closest('article, [data-testid^="conversation-turn"]') || lastUser;
      const parts = [];
      for (let n = turn.nextElementSibling; n; n = n.nextElementSibling) parts.push(n.innerText || '');
      const t = clean(parts.join('\n'));
      if (t) return t;
    }
    const main = $('main') || document.body;
    const all = main.innerText || '';
    const tail = lastPrompt.trim().split('\n').filter(Boolean).pop() || '';
    const i = tail ? all.lastIndexOf(tail.slice(-120)) : -1;
    if (i < 0) return '';
    return clean(all.slice(i + tail.slice(-120).length));
  }

  // Our question is in the chat (sent). ChatGPT shows `code` without the backticks, so spaces and
  // formatting marks are ignored when comparing.
  const squash = (s) => String(s || '').replace(/[`*_\s]+/g, '');
  function askedShown() {
    if (!lastPrompt) return false;
    const box = composer();
    const chat = [...document.querySelectorAll('[data-message-author-role="user"]')].map((e) => e.innerText).join('\n') || (($('main') || document.body).innerText || '').replace(box?.innerText || '', '');
    // A folded long question shows only its start.
    return squash(chat).includes(squash(lastPrompt).slice(-60)) || squash(chat).includes(squash(lastPrompt).slice(0, 60));
  }

  // New ChatGPT pages start every message with a hidden "ChatGPT said:" / "You said:" label.
  // Status lines ("ChatGPT is responding", "Thinking", "Thought for 5s") are shown while it works.
  // The page footer ("ChatGPT is AI and can make mistakes. Check important info.") is not an answer;
  // older pages said "ChatGPT can make mistakes".
  const STATUS = /^\s*((chatgpt|you)\s+said:?|(chatgpt\s+is\s+)?(responding|thinking|typing|writing|generating|searching|reasoning|analy[sz]ing|working|loading)(\s+the\s+web)?|thought\s+for\s+[\w\s.]+|stopped\s+thinking)[\s:.…]*$/i;
  const DISCLAIMER = /chatgpt(?:'s)?(?:\s+is(?:\s+an?)?\s+ai(?:\s+and)?)?\s+can make mistakes/i;
  // A long question is folded in the chat as "…" + "Show more": page buttons, not part of the answer.
  const CHROME_LINE = /^\s*(ask anything|message chatgpt|check important info\.?|show (more|less)|\.{2,}|…+)\s*$/i;
  function clean(t) {
    let s = String(t || '');
    const at = s.search(DISCLAIMER);
    if (at >= 0) s = s.slice(0, at);
    s = s.split(/\n(?:Ask anything|Message ChatGPT)\b/i)[0];
    const lines = s.split(/\r?\n/).filter((l) => !STATUS.test(l) && !CHROME_LINE.test(l));
    return lines.join('\n').replace(/\n?\s*check important info\.?\s*$/i, '').trim();
  }

  // The Copy / thumbs / regenerate buttons appear under an answer only once it is complete. They are
  // looked for anywhere after the answer and before the next question, whatever wraps the turn.
  const DONE_SEL = '[data-testid*="copy-turn" i], [data-testid*="good-response" i], [data-testid*="bad-response" i], button[aria-label="Copy"], button[aria-label*="Good response" i]';
  const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  function doneButtons(el) {
    if (!el) return false;
    const next = [...document.querySelectorAll('[data-message-author-role="user"]')].find((u) => follows(el, u));
    return [...document.querySelectorAll(DONE_SEL)].some((b) => !el.contains(b) && follows(el, b) && (!next || follows(b, next)));
  }

  // The reply to the question that carries this reference ("Ref: Q7K2M9"): the turns after that
  // question, up to the next question. Answers can repeat ("No", "No"), the reference does not.
  function replyTo(ref) {
    const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
    const mine = users.filter((u) => (u.innerText || '').includes(ref)).pop();
    if (!mine) return { sent: false, text: '' };
    // The assistant messages between our question and the next question, in page order. This does not
    // depend on how ChatGPT wraps a turn (article, section, div...), which it changes often.
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const next = users.find((u) => u !== mine && after(mine, u));
    const mineAns = [...document.querySelectorAll('[data-message-author-role="assistant"]')]
      .filter((a) => after(mine, a) && (!next || after(a, next)) && !a.parentElement?.closest('[data-message-author-role="assistant"]'));
    if (mineAns.length) {
      const text = mineAns.map((a) => {
        const md = [...a.querySelectorAll('.markdown, [class*="markdown"]')].pop();
        return (md || a).innerText || '';
      }).join('\n');
      const code = mineAns.flatMap((a) => [...a.querySelectorAll('pre code, pre')]).map((c) => c.innerText.trim()).find((t) => /^[[{]/.test(t)) || '';
      return { sent: true, text: clean(text), code, done: doneButtons(mineAns[mineAns.length - 1]) };
    }
    // Older layouts: the sibling turns after the question's turn.
    const turn = mine.closest('article, [data-testid^="conversation-turn"], section, [data-turn]') || mine;
    const parts = [];
    for (let n = turn.nextElementSibling; n; n = n.nextElementSibling) {
      if (n.querySelector?.('[data-message-author-role="user"]') || n.getAttribute?.('data-message-author-role') === 'user') break;
      const md = [...(n.querySelectorAll?.('.markdown, [class*="markdown"]') || [])].pop();
      parts.push((md || n).innerText || '');
    }
    return { sent: true, text: clean(parts.join('\n')), code: '', done: doneButtons(turn.nextElementSibling?.querySelector?.('[data-message-author-role="assistant"]') || turn.nextElementSibling) };
  }

  // What the page shows right now.
  // Everything the page shows after our reference (our question, then the reply). Works with any layout.
  function textAfterRef(ref) {
    const all = (($('main') || document.body).innerText || '');
    const i = all.lastIndexOf(ref);
    if (i < 0) return '';
    let s = all.slice(i + ref.length);
    const at = s.search(DISCLAIMER);
    if (at >= 0) s = s.slice(0, at);
    return s.split(/\n(?:Ask anything|Message ChatGPT)\b/i)[0];
  }

  function read(ref) {
    if (ref) {
      const r = replyTo(ref);
      const after = textAfterRef(ref);
      return { count: answers().length, text: r.text, code: r.code || '', how: r.sent ? 'reply to ref' : after ? 'page text after ref' : 'ref not on page', after, ref: true, refSent: r.sent || !!after,
        asked: r.sent || !!after, done: !!r.done, streaming: !!stopButton(), ready: visible(composer()) && !stopButton(), problem: pageProblem() };
    }
    const list = answers();
    const el = list[list.length - 1];
    // A letter or longer text may come in a "Writing" box (an editable document inside the answer):
    // then that box holds the answer. Otherwise only the answer's own text box is read (the message
    // around it also holds labels and status lines).
    const doc = el && [...el.querySelectorAll('[contenteditable="true"], .ProseMirror')].pop();
    const md = el && [...el.querySelectorAll('.markdown, [class*="markdown"]')].pop();
    let text = el ? clean((doc || md || el).innerText) : '';
    let how = el ? 'answer box' : '';
    if (!text) { text = textAfterPrompt(); how = text ? 'page text' : 'nothing found'; }
    // JSON answers usually come in a code block; prefer its exact content.
    const code = el ? [...el.querySelectorAll('pre code, pre')].map((c) => c.innerText.trim()).find((t) => /^[[{]/.test(t)) || '' : '';
    return { count: list.length, text, code, how, after: el ? textAfterPrompt() : '', asked: askedShown(), done: doneButtons(el), streaming: !!stopButton(), ready: visible(composer()) && !stopButton(), problem: pageProblem() };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'cgptPing') {
      sendResponse({ ok: true, ready: visible(composer()), problem: pageProblem() });
      return;
    }
    // Is this text (the profile marker) already in this chat?
    if (msg?.type === 'cgptHas') {
      const users = [...document.querySelectorAll('[data-message-author-role="user"]')].map((e) => e.innerText).join('\n');
      const all = users || (($('main') || document.body).innerText || '');
      sendResponse({ ok: true, found: !!msg.text && all.includes(msg.text) });
      return;
    }
    if (msg?.type === 'cgptRead') {
      sendResponse({ ok: true, ...read(msg.ref) });
      return;
    }
    if (msg?.type === 'cgptSend') {
      sendPrompt(msg.prompt)
        .then((before) => sendResponse({ ok: true, before }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });
})();
