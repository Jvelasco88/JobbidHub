// A small stand-in for react-select (Greenhouse's new job boards, many others), with the same markup and
// behaviour the filler meets there: the list opens on mousedown or ArrowDown, typing filters it, a click
// picks an option and shows it in .select__single-value, Escape / leaving the box closes it.
// <div class="select" data-options="A|B|C"> or data-search="city" (results arrive after 400 ms, like a server).
const CITIES = ['Chicago, Illinois, United States', 'North Chicago, Illinois, United States', 'Chicago Heights, Illinois, United States', 'Chicago Ridge, Illinois, United States',
  'Springfield, Illinois, United States', 'New York, New York, United States', 'Austin, Texas, United States'];
let n = 0;
for (const root of document.querySelectorAll('.select[data-options], .select[data-search]')) {
  const id = root.dataset.id || `rs${n++}`;
  const label = root.dataset.label;
  const required = root.hasAttribute('data-required');
  root.innerHTML = `<label id="${id}-label" for="${id}" class="select__label">${label}${required ? '<span aria-hidden="true">*</span>' : ''}</label>
    <div class="select-shell"><div class="select__control"><div class="select__value-container">
      <div class="select__placeholder">Select...</div>
      <div class="select__input-container"><input class="select__input" id="${id}" role="combobox" type="text" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-haspopup="true" aria-labelledby="${id}-label" ${required ? 'aria-required="true"' : ''} aria-controls="${id}-listbox"></div>
    </div><div class="select__indicators"><button type="button" class="icon-button" aria-label="Toggle flyout" tabindex="-1">▾</button></div></div></div>
    <input type="hidden" name="${id}" class="rs-value">`;
  const input = root.querySelector('input.select__input');
  const control = root.querySelector('.select__control');
  const valueBox = root.querySelector('.select__value-container');
  const hidden = root.querySelector('.rs-value');
  const fixed = root.dataset.options ? root.dataset.options.split('|') : null;
  let menu = null, timer = null;
  const close = () => { menu?.remove(); menu = null; input.setAttribute('aria-expanded', 'false'); };
  const pick = (text) => {
    hidden.value = text;
    valueBox.querySelector('.select__placeholder, .select__single-value')?.remove();
    const v = document.createElement('div');
    v.className = 'select__single-value';
    v.textContent = text;
    valueBox.prepend(v);
    input.value = '';
    close();
  };
  const render = (items, note) => {
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'select__menu';
      root.querySelector('.select-shell').append(menu);
      input.setAttribute('aria-expanded', 'true');
    }
    menu.innerHTML = `<div class="select__menu-list" role="listbox" id="${id}-listbox"></div>`;
    const list = menu.firstChild;
    if (note) { list.innerHTML = `<div class="select__menu-notice">${note}</div>`; return; }
    items.forEach((t, i) => {
      const o = document.createElement('div');
      o.className = 'select__option';
      o.setAttribute('role', 'option');
      o.id = `${id}-option-${i}`;
      o.textContent = t;
      o.addEventListener('click', () => pick(t));
      list.append(o);
    });
  };
  const update = () => {
    const q = input.value.trim().toLowerCase();
    if (fixed) return render(fixed.filter((t) => t.toLowerCase().includes(q)), fixed.some((t) => t.toLowerCase().includes(q)) ? '' : 'No options');
    // Online search: nothing until something is typed, then a short wait for the "server".
    if (!q) return render([], 'Type to search');
    render([], 'Loading...');
    clearTimeout(timer);
    timer = setTimeout(() => { const hits = CITIES.filter((c) => c.toLowerCase().includes(q)); render(hits, hits.length ? '' : 'No options'); }, 400);
  };
  control.addEventListener('mousedown', (e) => { if (e.target !== input) e.preventDefault(); input.focus(); menu ? close() : update(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !menu) update();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && menu) { const first = menu.querySelector('.select__option'); if (first) { e.preventDefault(); pick(first.textContent); } }
  });
  input.addEventListener('input', update);
  input.addEventListener('blur', () => setTimeout(close, 150));
}
