const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let token = localStorage.getItem('fragment_token') || '';
let devCode = localStorage.getItem('fragment_code') || '12345';
let me = null;
let catalog = [];
let auctions = [];
let prefix = localStorage.getItem('fragment_prefix') || '7';
const SPIN_COST = 10;
let spinTimer = null;
let spinOdds = null;

function randomReel() {
  const rnd = (len) => Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
  return `+888 ${rnd(3)}-${rnd(3)}-${rnd(2)}`;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}

function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`.trim();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 4500);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

function showLogin() {
  $('#login').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function setPrefix(next) {
  prefix = next;
  localStorage.setItem('fragment_prefix', prefix);
  $('#prefix-range').value = prefix === '888' ? '1' : '0';
  $('#prefix-switch').style.setProperty('--pos', prefix === '888' ? '1' : '0');
  $$('.prefix-label').forEach((b) => b.classList.toggle('active', b.dataset.prefix === prefix));
}

function sortItems(items) {
  const mode = $('#sort').value;
  const copy = [...items];
  if (mode === 'price-asc') copy.sort((a, b) => a.priceGrams - b.priceGrams);
  else if (mode === 'price-desc') copy.sort((a, b) => b.priceGrams - a.priceGrams);
  else copy.sort((a, b) => b.rarity.score - a.rarity.score || b.priceGrams - a.priceGrams);
  return copy;
}

function renderSpinOdds() {
  const box = $('#spin-odds');
  if (!box || !spinOdds) return;
  box.innerHTML = `
    <div class="odds-title">Шансы · цена при продаже</div>
    ${spinOdds.tiers.map((tier) => `
      <div class="odds-row">
        <span class="odds-dot" style="background:${esc(tier.color)}"></span>
        <span class="odds-name">${esc(tier.label)}</span>
        <span class="odds-value">${fmt(tier.priceGrams)} gram</span>
        <span class="odds-pct">${tier.probability}%</span>
      </div>`).join('')}`;
}

async function refreshSpinOdds() {
  spinOdds = await api('/api/numbers/spin-odds');
  renderSpinOdds();
}

function updateSpinButton() {
  const button = $('#spin-button');
  const hint = $('#spin-hint');
  if (!button || !hint) return;
  const affordable = me && me.balanceGrams >= SPIN_COST;
  button.disabled = !affordable;
  hint.textContent = affordable
    ? `На балансе ${fmt(me.balanceGrams)} gram — можно крутить.`
    : `Нужно ${SPIN_COST} gram. Пополни кошелёк звёздами.`;
}

function renderHeader() {
  const name = [me.user.firstName, me.user.lastName].filter(Boolean).join(' ')
    || me.user.phone;
  $('#who').textContent = name;
  $('#balance').textContent = `${fmt(me.balanceGrams)} gram`;
  $('#stars-balance').textContent = `${fmt(me.starsBalance)} ★`;
  $('#wallet-balance').textContent = `${fmt(me.balanceGrams)} gram`;
  $('#wallet-stars').textContent = `${fmt(me.starsBalance)} ★`;
  $('#my-count').textContent = String(me.numbers.length);
  $('#auction-count').textContent = String(auctions.length);
  updateSpinButton();
}

function proportionHtml(rarity) {
  if (!rarity?.segments?.length) return '';
  const segs = rarity.segments.map((s) => (
    `<span style="width:${(s.share * 100).toFixed(2)}%;background:${s.color}" title="цифра ${s.digit}: ${s.count}"></span>`
  )).join('');
  const legend = rarity.segments.slice(0, 8).map((s) => (
    `<span><i style="background:${s.color}"></i>${s.digit}×${s.count}</span>`
  )).join('');
  return `
    <div>
      <div class="prop-label">Пропорции цифр</div>
      <div class="proportion">${segs}</div>
      <div class="prop-legend">${legend}</div>
    </div>`;
}

function rarityHtml(rarity) {
  return `
    <div class="rarity-row">
      <div class="rarity-top">
        <span class="rarity-name">${esc(rarity.label)}</span>
        <span class="rarity-score">${rarity.score}/100 · ${rarity.unique} уник. цифр</span>
      </div>
      <div class="rarity-bar"><i style="width:${rarity.score}%"></i></div>
      <div class="pattern">${esc(rarity.pattern)}</div>
    </div>`;
}

function directoryHtml(item, isMine) {
  if (item.auction) {
    const ends = new Date(item.auction.endsAt).toLocaleString('ru-RU');
    return `
      <div class="auction-box">
        <div>Аукцион · ставка <b>${fmt(item.auction.currentBidGrams)} gram</b></div>
        <div class="timer">до ${esc(ends)}</div>
      </div>
      <form data-action="bid" data-id="${item.auction.id}" class="stack">
        <input type="number" min="1" step="1" name="amount" placeholder="Ваша ставка, gram" required>
        <button class="primary" type="submit">Сделать ставку</button>
      </form>`;
  }

  if (isMine) {
    return `
      <div class="actions">
        <form data-action="sell" data-id="${item.id}">
          <input type="number" min="0" step="1" name="price" value="${item.priceGrams || ''}" placeholder="Цена, gram">
          <button type="submit">${item.priceGrams > 0 ? 'Изменить' : 'Продать'}</button>
        </form>
        <form data-action="auction" data-id="${item.id}">
          <input type="number" min="1" step="1" name="startingPrice" placeholder="Старт аукциона, gram" required>
          <button type="submit">На аукцион</button>
        </form>
        <div class="form-note">24 часа · победитель получает номер навсегда</div>
      </div>`;
  }

  if (item.priceGrams > 0) {
    return `
      <form data-action="buy" data-id="${item.id}">
        <div class="price">${fmt(item.priceGrams)} <small>gram</small></div>
        <button class="primary" type="submit">Купить</button>
      </form>`;
  }
  return '<div class="form-note">Не выставлен на продажу</div>';
}

function cardHtml(item, isMine = false) {
  const badgeClass = item.prefix === '888' ? 'prefix-badge p888' : 'prefix-badge';
  const tag = isMine
    ? '<span class="tag mine">Ваш номер</span>'
    : item.status === 'vault'
      ? '<span class="tag vault">Хранилище</span>'
      : item.auction
        ? '<span class="tag auction">Аукцион</span>'
        : '<span class="tag">Продажа</span>';

  const owner = item.owner
    ? (isMine ? 'Вы' : `Владелец: ${esc(item.owner.name)}`)
    : 'Хранилище Fragment';

  return `
    <article class="item">
      <div class="item-head">
        <div class="num"><span class="prefix">${item.prefix === '888' ? '+888' : '+7'}</span>${esc(item.display.replace(/^\+\d+\s*/, ''))}</div>
        <span class="${badgeClass}">${item.prefix === '888' ? '888' : 'RU'}</span>
      </div>
      ${rarityHtml(item.rarity)}
      ${proportionHtml(item.rarity)}
      <div class="item-foot">
        <div class="price">${item.auction ? fmt(item.auction.currentBidGrams) : fmt(item.priceGrams)} <small>gram</small></div>
        <div class="owner">${tag}<br>${owner}</div>
      </div>
      ${directoryHtml(item, isMine)}
    </article>`;
}

function renderCatalog() {
  const list = $('#catalog-list');
  const items = sortItems(catalog);
  list.innerHTML = items.length
    ? items.map((it) => cardHtml(it, false)).join('')
    : '<div class="empty">Ничего не найдено. Попробуй другой префикс или запрос.</div>';

  const active = catalog.filter((it) => it.auction);
  auctions = active;
  $('#auction-count').textContent = String(active.length);
  $('#auction-list').innerHTML = active.length
    ? active.map((it) => cardHtml(it, false)).join('')
    : '<div class="empty">Активных аукционов нет. Выставь свой номер первым.</div>';

  const prices = catalog.filter((it) => it.priceGrams > 0).map((it) => it.priceGrams);
  $('#picker-count').textContent = `${catalog.length} номеров`;
  $('#picker-range').textContent = prices.length
    ? `от ${fmt(Math.min(...prices))} gram` : 'нет в продаже';
}

function renderMine() {
  $('#mine-list').innerHTML = me.numbers.length
    ? me.numbers.map((it) => cardHtml(it, true)).join('')
    : '<div class="empty">У тебя пока нет номеров. Купи один в каталоге — он станет твоим навсегда.</div>';
}

async function refreshMe() {
  me = await api('/api/me');
  renderHeader();
  renderMine();
}

async function refreshCatalog() {
  const q = $('#search').value.replace(/\D/g, '').slice(0, 12);
  const data = await api(`/api/numbers?prefix=${encodeURIComponent(prefix)}&q=${encodeURIComponent(q)}`);
  catalog = data.items;
  renderCatalog();
}

async function refreshAll() {
  await Promise.all([refreshMe(), refreshCatalog(), refreshSpinOdds()]);
}

/* ---------------- events ---------------- */

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hint = $('#login-hint');
  hint.textContent = '';
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    devCode = $('#code').value.trim() || '12345';
    localStorage.setItem('fragment_code', devCode);
    await api('/api/auth/request', { method: 'POST', body: JSON.stringify({ phone: $('#phone').value }) });
    const res = await api('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ phone: $('#phone').value, code: devCode }),
    });
    token = res.token;
    localStorage.setItem('fragment_token', token);
    showApp();
    await refreshAll();
  } catch (err) {
    hint.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#logout').addEventListener('click', () => {
  token = '';
  me = null;
  localStorage.removeItem('fragment_token');
  showLogin();
});

$('#spin-button').addEventListener('click', async () => {
  const button = $('#spin-button');
  const reel = $('#spin-reel');
  const hint = $('#spin-hint');
  if (spinTimer || button.disabled) return;

  button.disabled = true;
  hint.textContent = 'Крутим барабан…';
  reel.classList.remove('won');
  reel.classList.add('spinning');
  spinTimer = setInterval(() => { reel.textContent = randomReel(); }, 70);

  try {
    const started = Date.now();
    const res = await api('/api/number/spin', { method: 'POST', body: '{}' });
    const wait = Math.max(0, 850 - (Date.now() - started));
    setTimeout(() => {
      clearInterval(spinTimer);
      spinTimer = null;
      reel.classList.remove('spinning');
      reel.classList.add('won');
      reel.textContent = res.number.display;
      hint.textContent = `Выпал ${res.number.display} · ${fmt(res.valueGrams)} gram при продаже · ${res.tier.label} (${res.tier.probability}%)`;
      toast(`Номер ${res.number.display} выставлен за ${fmt(res.valueGrams)} gram`, 'ok');
      const mineTab = document.querySelector('.tab[data-tab="mine"]');
      if (mineTab) mineTab.click();
      refreshAll().catch((err) => toast(err.message, 'error'));
    }, wait);
  } catch (err) {
    clearInterval(spinTimer);
    spinTimer = null;
    reel.classList.remove('spinning');
    reel.textContent = '+888 ???-???-???';
    hint.textContent = err.message;
    toast(err.message, 'error');
    updateSpinButton();
  }
});

$$('.tab').forEach((btn) => btn.addEventListener('click', () => {
  $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
}));

$('#prefix-range').addEventListener('input', (e) => {
  setPrefix(e.target.value === '1' ? '888' : '7');
  refreshCatalog().catch((err) => toast(err.message, 'error'));
});
$$('.prefix-label').forEach((btn) => btn.addEventListener('click', () => {
  setPrefix(btn.dataset.prefix);
  refreshCatalog().catch((err) => toast(err.message, 'error'));
}));

$('#refresh-catalog').addEventListener('click', () => {
  refreshAll().catch((err) => toast(err.message, 'error'));
});

let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refreshCatalog().catch((e) => toast(e.message, 'error')), 250);
});
$('#sort').addEventListener('change', renderCatalog);

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-action]');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const id = form.dataset.id;
    const fd = new FormData(form);
    if (form.dataset.action === 'buy') {
      await api(`/api/number/${id}/buy`, { method: 'POST', body: '{}' });
      toast('Номер куплен и закреплён за тобой', 'ok');
    } else if (form.dataset.action === 'sell') {
      const price = Number(fd.get('price') || 0);
      await api(`/api/number/${id}/sell`, {
        method: 'POST', body: JSON.stringify({ priceGrams: price }),
      });
      toast(price > 0 ? 'Номер выставлен на продажу' : 'Номер снят с продажи', 'ok');
    } else if (form.dataset.action === 'auction') {
      await api(`/api/number/${id}/auction`, {
        method: 'POST',
        body: JSON.stringify({ startingPrice: Number(fd.get('startingPrice')), durationHours: 24 }),
      });
      toast('Аукцион создан на 24 часа', 'ok');
    } else if (form.dataset.action === 'bid') {
      await api(`/api/auction/${id}/bid`, {
        method: 'POST', body: JSON.stringify({ amount: Number(fd.get('amount')) }),
      });
      toast('Ставка принята', 'ok');
    }
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

$('#exchange-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hint = $('#exchange-hint');
  hint.textContent = '';
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const res = await api('/api/wallet/topup-stars', {
      method: 'POST',
      body: JSON.stringify({
        phone: me.user.phone,
        code: devCode,
        stars: Number($('#exchange-stars').value),
      }),
    });
    $('#exchange-stars').value = '';
    hint.textContent = `Получено ${fmt(res.gramBalance - me.balanceGrams)} gram`;
    toast('Звёзды обменяны на gram', 'ok');
    await refreshAll();
  } catch (err) {
    hint.textContent = err.message;
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

$('#topup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/api/dev/topup', {
      method: 'POST',
      body: JSON.stringify({
        amount: Number($('#topup-amount').value),
        secret: $('#topup-secret').value,
      }),
    });
    $('#topup-amount').value = '';
    toast(`Баланс: ${fmt(res.balanceGrams)} gram`, 'ok');
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

setPrefix(prefix);
if (token) {
  showApp();
  refreshAll().catch(() => {
    token = '';
    localStorage.removeItem('fragment_token');
    showLogin();
  });
} else {
  showLogin();
}
