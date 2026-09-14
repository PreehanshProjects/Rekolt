/* ═══════════════════════════════════════════════════════════════════════
   REKOLT — order docket
   Turns taps on the price list into the WhatsApp shorthand a chef already
   writes. No framework, no build, no dependencies.
   ═══════════════════════════════════════════════════════════════════════ */

/* ───────────────────────────────────────────────────────────────────────
   Contact settings. WhatsApp supplied by the business owner.
   Email is optional and remains hidden until supplied.
   WHATSAPP: full international format, digits only, no "+" and no spaces.
   Mauritius is country code 230 — e.g. a number 5 123 4567 becomes
   "23051234567".
   ─────────────────────────────────────────────────────────────────────── */
const CONFIG = {
  WHATSAPP: '23057563134',       // Mauritius: +230 5756 3134
  EMAIL:    '',                 // e.g. 'orders@rekolt.mu'
};

(function () {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const STORE_KEY = 'rekolt.order.v1';

  const state = {
    unit: '500g',                 // '500g' | 'kg' — herbs only
    order: new Map(),             // id -> qty
    category: 'all',
    business: '',
    notes: '',
  };

  /* ── Catalogue, read straight off the rendered list ─────────────────── */
  const catalogue = new Map();
  $$('.line').forEach((el) => {
    catalogue.set(el.dataset.id, {
      el,
      id: el.dataset.id,
      name: el.dataset.name,
      variable: el.dataset.variable === '1',
      onRequest: el.dataset.onrequest === '1',
      unitLabel: el.dataset.unitLabel || null,
      price: Number(el.dataset.price || 0),
      price500: Number(el.dataset.price500 || 0),
      priceKg: Number(el.dataset.pricekg || 0),
    });
  });

  const search = $('[data-search]');
  const aliases = {
    microgreen: 'microgreens sprouts', fleur: 'edible flowers', fraise: 'strawberry strawberries',
    ananas: 'pineapple', coco: 'coconut', laitue: 'lettuce salad', concombre: 'cucumber',
    betterave: 'beet beetroot', ail: 'garlic', gingembre: 'ginger', menthe: 'mint',
    thym: 'thyme', coriandre: 'coriander cilantro cotomili', queue: 'spring onion scallion', persil: 'parsley',
  };
  const normalize = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  function filterProduce() {
    const terms = normalize(search.value).split(/\s+/).filter(Boolean);
    let matches = 0;
    $$('[data-category]').forEach((group) => {
      let visible = 0;
      $$('.line', group).forEach((line) => {
        const haystack = normalize(`${line.textContent} ${aliases[line.dataset.id] || ''}`);
        const show = (state.category === 'all' || group.dataset.category === state.category)
          && terms.every((term) => haystack.includes(term));
        line.hidden = !show;
        if (show) visible++;
      });
      group.hidden = visible === 0;
      matches += visible;
    });
    $$('[data-filter]').forEach((link) => {
      if (link.dataset.filter === state.category) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    $('[data-search-clear]').hidden = !search.value;
    $('[data-search-empty]').hidden = matches > 0;
    $('[data-search-count]').textContent = `${matches} ${matches === 1 ? 'ingredient' : 'ingredients'}`;
  }
  $('[data-catalogue-tools]').hidden = false;
  search.addEventListener('input', filterProduce);
  $('[data-search-clear]').addEventListener('click', () => {
    search.value = ''; filterProduce(); search.focus();
  });
  $('[data-search-reset]').addEventListener('click', () => {
    state.category = 'all'; search.value = ''; filterProduce(); search.focus();
  });
  // Links remain useful category anchors without JavaScript.
  $$('[data-filter]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      state.category = link.dataset.filter;
      filterProduce();
      const rail = $('.catalogue-layout');
      if (rail.getBoundingClientRect().top < 0) {
        rail.scrollIntoView({ block: 'start' });
      }
    });
  });

  /* ── Formatting ─────────────────────────────────────────────────────── */
  const rs = (n) => Math.round(n).toLocaleString('en-US');

  function unitPrice(item) {
    if (!item.variable) return item.price;
    return state.unit === 'kg' ? item.priceKg : item.price500;
  }

  /** Human weight for a variable item at a given multiple of the unit. */
  function weightLabel(qty) {
    if (state.unit === 'kg') return `${qty} kg`;
    const grams = qty * 500;
    if (grams % 1000 === 0) return `${grams / 1000} kg`;
    if (grams > 1000) return `${(grams / 1000).toFixed(1)} kg`;
    return `${grams} g`;
  }

  /** What one unit of this item is called, for the price row. */
  function rowUnitLabel(item) {
    if (item.variable) return state.unit === 'kg' ? 'per 1 kg' : 'per 500 g';
    if (item.unitLabel === 'kg') return 'per kg';
    return item.unitLabel === 'barquette' ? 'per barquette' : 'per piece';
  }

  /** How a quantity of this item reads in an order list. */
  function qtyLabel(item, qty) {
    if (item.variable) return weightLabel(qty);
    if (item.unitLabel === 'kg') return `${qty} kg`;
    if (item.unitLabel === 'barquette') return `${qty} ${qty === 1 ? 'barquette' : 'barquettes'}`;
    return `${qty} pc`;
  }

  /* ── Persistence ────────────────────────────────────────────────────── */
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        unit: state.unit,
        order: Array.from(state.order.entries()),
        business: state.business,
        notes: state.notes,
      }));
    } catch (_) { /* private mode — the page still works, it just forgets */ }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.unit === 'kg' || data.unit === '500g') state.unit = data.unit;
      if (typeof data.business === 'string') state.business = data.business.slice(0, 100);
      if (typeof data.notes === 'string') state.notes = data.notes.slice(0, 600);
      if (Array.isArray(data.order)) {
        data.order.forEach(([id, qty]) => {
          if (catalogue.has(id) && Number.isInteger(qty) && qty > 0 && qty <= 200) state.order.set(id, qty);
        });
      }
    } catch (_) { /* corrupt payload — start clean */ }
  }

  /* ── Unit switch ────────────────────────────────────────────────────── */
  function paintUnit() {
    $$('.segmented__btn').forEach((b) => {
      const on = b.dataset.unit === state.unit;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });

    catalogue.forEach((item) => {
      if (!item.variable) return;
      const priceSlot = $('[data-price-slot]', item.el);
      const unitSlot  = $('[data-unit-slot]', item.el);
      if (priceSlot) priceSlot.textContent = rs(unitPrice(item));
      if (unitSlot)  unitSlot.textContent  = rowUnitLabel(item);
    });
  }

  $$('.segmented__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.unit = btn.dataset.unit;
      paintUnit();
      renderDocket();
      save();
    });
  });

  /* ── Selecting lines ────────────────────────────────────────────────── */
  $$('.line').forEach((el) => {
    const btn = $('.line__btn', el);
    const item = catalogue.get(el.dataset.id);
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      if (state.order.has(item.id)) {
        state.order.delete(item.id);
        announce(`${item.name} removed from your order.`);
      } else {
        state.order.set(item.id, 1);
        announce(`${item.name} added — ${qtyLabel(item, 1)}.`);
      }
      paintLines();
      renderDocket();
      save();
    });
  });

  function paintLines() {
    catalogue.forEach((item) => {
      const on = state.order.has(item.id);
      item.el.classList.toggle('is-on', on);
      const btn = $('.line__btn', item.el);
      if (btn) btn.setAttribute('aria-pressed', String(on));
    });
  }

  /* ── The docket ─────────────────────────────────────────────────────── */
  const docketLines = $('[data-docket-lines]');
  const docketEmpty = $('[data-docket-empty]');
  const docketFoot  = $('[data-docket-foot]');
  const totalSlot   = $('[data-docket-total]');
  const tray        = $('[data-tray]');
  const clearBtn    = $('[data-clear]');
  const businessInput = $('[data-order-business]');
  const notesInput = $('[data-order-notes]');
  const drawer = $('[data-order-drawer]');
  const workspace = $('[data-order-workspace]');
  const orderHome = $('[data-order-home]');
  let drawerOpener;
  let drawerScrollY = 0;
  let browseProduceOnClose = false;

  function openOrder(opener) {
    if (typeof drawer.showModal !== 'function') return false;
    if (drawer.open) return true;
    drawerOpener = opener;
    drawerScrollY = window.scrollY;
    $('[data-drawer-body]').append(workspace);
    drawer.showModal();
    document.body.classList.add('order-open');
    $('[data-toast]').hidden = true;
    return true;
  }
  $$('[data-drawer-close]').forEach((button) => button.addEventListener('click', () => drawer.close()));
  drawer.addEventListener('click', (event) => {
    const rect = drawer.getBoundingClientRect();
    if (event.target === drawer && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) drawer.close();
  });
  drawer.addEventListener('close', () => {
    orderHome.append(workspace);
    document.body.classList.remove('order-open');
    if (browseProduceOnClose) {
      browseProduceOnClose = false;
      $('#prices').scrollIntoView({ block: 'start' });
      search.focus({ preventScroll: true });
    } else {
      window.scrollTo({ top: drawerScrollY, behavior: 'instant' });
      const focusTarget = drawerOpener?.isConnected && drawerOpener.getClientRects().length
        ? drawerOpener : $('.topnav__cta');
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
  });
  drawer.addEventListener('click', (event) => {
    if (event.target.closest('a[href="#prices"]')) {
      event.preventDefault();
      browseProduceOnClose = true;
      drawer.close();
    }
  });
  [businessInput, notesInput].forEach((input) => input.addEventListener('input', () => {
    state.business = businessInput.value.slice(0, 100);
    state.notes = notesInput.value.slice(0, 600);
    wireWhatsApp(); save();
  }));

  /** Priced lines only. An "on request" line must never invent a figure. */
  function total() {
    let sum = 0;
    state.order.forEach((qty, id) => {
      const item = catalogue.get(id);
      if (item && !item.onRequest) sum += unitPrice(item) * qty;
    });
    return sum;
  }

  function hasOnRequest() {
    for (const id of state.order.keys()) {
      const item = catalogue.get(id);
      if (item && item.onRequest) return true;
    }
    return false;
  }

  function renderDocket() {
    docketLines.textContent = '';
    const count = state.order.size;

    docketEmpty.hidden = count > 0;
    docketFoot.hidden = count === 0;
    clearBtn.hidden = count === 0;
    $('[data-order-details]').hidden = count === 0;
    $('[data-copy]').disabled = count === 0;
    $$('[data-order-count]').forEach((slot) => { slot.textContent = String(count); slot.hidden = count === 0; });

    state.order.forEach((qty, id) => {
      const item = catalogue.get(id);
      if (!item) return;

      const li = document.createElement('li');
      li.className = 'dline';
      li.dataset.docketId = id;

      const name = document.createElement('span');
      name.className = 'dline__name';
      name.append(item.name);
      const unit = document.createElement('span');
      unit.className = 'dline__unit';
      unit.textContent = item.onRequest
        ? `${qtyLabel(item, qty)} · rate confirmed on order`
        : `${qtyLabel(item, qty)} · Rs ${rs(unitPrice(item))} ${rowUnitLabel(item).replace('per ', '/ ')}`;
      name.append(unit);

      const stepper = document.createElement('span');
      stepper.className = 'stepper';

      const minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '−';
      minus.setAttribute('aria-label', `Less ${item.name}`);
      minus.addEventListener('click', () => bump(id, -1));

      const val = document.createElement('span');
      val.className = 'stepper__val';
      val.textContent = qtyLabel(item, qty);

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.textContent = '+';
      plus.setAttribute('aria-label', `More ${item.name}`);
      plus.addEventListener('click', () => bump(id, 1));

      stepper.append(minus, val, plus);

      const amt = document.createElement('span');
      amt.className = 'dline__amt';
      if (item.onRequest) {
        amt.classList.add('dline__amt--ask');
        amt.textContent = 'On request';
      } else {
        const amtRs = document.createElement('span');
        amtRs.className = 'rs'; amtRs.textContent = 'Rs';
        const amtNum = document.createElement('span');
        amtNum.className = 'num'; amtNum.textContent = rs(unitPrice(item) * qty);
        amt.append(amtRs, amtNum);
      }

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'dline__rm';
      rm.setAttribute('aria-label', `Remove ${item.name}`);
      rm.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      rm.addEventListener('click', () => {
        state.order.delete(id);
        paintLines(); renderDocket(); save();
        focusDocket();
        announce(`${item.name} removed.`);
      });

      li.append(name, stepper, amt, rm);
      docketLines.append(li);
    });

    const sum = total();
    totalSlot.textContent = rs(sum);

    const askNote = $('[data-ask-note]');
    if (askNote) askNote.hidden = !hasOnRequest();

    // Tray
    tray.hidden = count === 0;
    $('[data-tray-count]').textContent = String(count);
    $('[data-tray-word]').textContent = count === 1 ? 'item' : 'items';
    $('[data-tray-total]').textContent = rs(sum);

    wireWhatsApp();
  }

  function bump(id, delta) {
    const item = catalogue.get(id);
    const next = (state.order.get(id) || 0) + delta;
    if (next <= 0) {
      state.order.delete(id);
    } else if (next <= 200) {
      state.order.set(id, next);
    }
    paintLines(); renderDocket(); save();
    const row = $$('.dline').find((line) => line.dataset.docketId === id);
    if (row) $('.stepper', row).querySelectorAll('button')[delta > 0 ? 1 : 0].focus({ preventScroll: true });
    else focusDocket();
    if (item) {
      announce(state.order.has(id)
        ? `${item.name}, ${qtyLabel(item, state.order.get(id))}.`
        : `${item.name} removed.`);
    }
  }

  function focusDocket() {
    const next = $('.stepper button', docketLines) || $('[data-wa-link]');
    if (next) next.focus({ preventScroll: true });
  }

  clearBtn.addEventListener('click', () => {
    state.order.clear();
    state.business = ''; state.notes = '';
    businessInput.value = ''; notesInput.value = '';
    paintLines(); renderDocket(); save();
    $('[data-wa-link]').focus({ preventScroll: true });
    announce('Order cleared.');
  });

  /* ── The message ────────────────────────────────────────────────────── */
  function orderText() {
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const lines = [`Rekolt order — ${date}`, ''];
    if (state.business.trim()) lines.push(`Name / business: ${state.business.trim()}`, '');

    let i = 1;
    state.order.forEach((qty, id) => {
      const item = catalogue.get(id);
      if (!item) return;
      const ask = item.onRequest ? ' (rate please)' : '';
      lines.push(`${i++}. ${item.name} ×${qtyLabel(item, qty)}${ask}`);
    });

    lines.push('', `Estimated total: Rs ${rs(total())}`);
    if (hasOnRequest()) lines.push('(excludes lines marked "rate please")');
    if (state.notes.trim()) lines.push('', `Notes: ${state.notes.trim()}`);
    return lines.join('\n');
  }

  const waLink   = $('[data-wa-link]');
  const waLabel  = $('[data-wa-label]');
  const waPlain  = $('[data-wa-plain]');
  const mailLink = $('[data-mail]');
  const note     = $('[data-placeholder-note]');

  const configured = Boolean(CONFIG.WHATSAPP);

  function wireWhatsApp() {
    const count = state.order.size;
    waLabel.textContent = count
      ? `Send ${count} ${count === 1 ? 'item' : 'items'} on WhatsApp`
      : 'Order on WhatsApp';

    if (!configured) {
      waLabel.textContent = 'WhatsApp ordering coming soon';
      waLink.setAttribute('aria-disabled', 'true');
      waLink.removeAttribute('target');
      waLink.href = '#order';
      return;
    }

    const body = count ? orderText() : 'Hello Rekolt — I would like to place an order.';
    waLink.removeAttribute('aria-disabled');
    waLink.href = `https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent(body)}`;
    waLink.target = '_blank';
    waLink.rel = 'noopener noreferrer';
  }

  if (configured) {
    if (note) note.hidden = true;
    if (waPlain) {
      waPlain.hidden = false;
      waPlain.href = `https://wa.me/${CONFIG.WHATSAPP}`;
      waPlain.target = '_blank';
      waPlain.rel = 'noopener noreferrer';
    }
  } else {
    const availability = $('[data-order-availability]');
    if (availability) availability.hidden = false;
    if (waPlain) waPlain.hidden = true;
    waLink.addEventListener('click', (e) => {
      e.preventDefault();
      announce('WhatsApp ordering is coming soon. Use “Copy the list” to save your order.');
    });
    if (waPlain) waPlain.addEventListener('click', (e) => e.preventDefault());
  }

  if (CONFIG.EMAIL && mailLink) {
    mailLink.href = `mailto:${CONFIG.EMAIL}`;
    mailLink.textContent = CONFIG.EMAIL;
  } else if (mailLink) {
    mailLink.hidden = true;
    mailLink.addEventListener('click', (e) => e.preventDefault());
    mailLink.setAttribute('aria-disabled', 'true');
  }

  /* ── Copy ───────────────────────────────────────────────────────────── */
  $('[data-copy]').addEventListener('click', async () => {
    if (!state.order.size) { announce('Nothing to copy yet — tap a line in the list.'); return; }
    const text = orderText();
    try {
      await navigator.clipboard.writeText(text);
      announce('Order copied. Paste it wherever you like.');
    } catch (_) {
      // Clipboard blocked (insecure context, old browser) — fall back to a selection
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
      announce(ok ? 'Order copied.' : 'Could not copy automatically — select the list and copy it.');
    }
  });

  /* ── Status line ────────────────────────────────────────────────────── */
  const live = $('[data-live]');
  let liveTimer;
  function announce(msg) {
    if (!live) return;
    live.textContent = msg;
    const toast = $('[data-toast]');
    $('[data-toast-text]').textContent = msg;
    toast.hidden = drawer.open;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { live.textContent = ''; toast.hidden = true; }, 4500);
  }

  /* ── Hide the tray once the real docket is on screen ─────────────────── */
  const orderSection = $('#order');
  if (orderSection && 'IntersectionObserver' in window) {
    new IntersectionObserver(
      ([entry]) => tray.classList.toggle('is-docked', entry.isIntersecting),
      { threshold: 0.18 }
    ).observe(orderSection);
  }

  /* ── Small truths ───────────────────────────────────────────────────── */
  const yearSlot = $('[data-year]');
  if (yearSlot) yearSlot.textContent = String(new Date().getFullYear());

  const countSlot = $('[data-item-count]');
  if (countSlot) countSlot.textContent = String(catalogue.size);

  $$('[data-order-jump]').forEach((a) => {
    a.addEventListener('click', (event) => {
      if (openOrder(a)) event.preventDefault();
    });
  });

  /* ── Go ─────────────────────────────────────────────────────────────── */
  restore();
  businessInput.value = state.business;
  notesInput.value = state.notes;
  paintUnit();
  paintLines();
  renderDocket();
})();
