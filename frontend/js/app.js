/* АС «Бортовой журнал автомобилиста» — экраны и маршрутизация */
(function () {
  'use strict';
  const { icon, esc, money, km, liters, date, dateLong, today, plural, plate, odometer, spinOdometers, modal, confirmDialog, toast, showErrors, clearErrors, field, MONTHS, MONTHS_SHORT } = window.UI;
  const root = document.getElementById('app');

  const state = { user: null, cars: [], categories: [], fuelTypes: [], flash: null };

  /* ---------------- Маршрутизация ---------------- */
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = h.split('?');
    return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  const go = (h) => { if (location.hash === h) render(); else location.hash = h; };

  /* Проверка токена при загрузке. 401 — на вход; сервер недоступен — ошибка выше, токен не трогаем */
  async function ensureSession() {
    if (state.user) return true;
    if (!API.token.get()) return false;
    try {
      const user = await API.me();
      [state.categories, state.fuelTypes, state.cars] = await Promise.all([API.repairCategories(), API.fuelTypes(), API.cars()]);
      state.user = user;
      return true;
    } catch (e) {
      if (e && e.status === 401) { API.token.set(null); state.user = null; return false; }
      throw e;
    }
  }
  async function refreshCars() { state.cars = await API.cars(); }

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    document.body.classList.add('loading');
    const { parts, query } = parseHash();
    try {
      const authed = await ensureSession();
      if (seq !== renderSeq) return;
      if (parts[0] === 'login' || parts[0] === 'register') {
        if (authed) return go('#/cars');
        return parts[0] === 'login' ? viewLogin() : viewRegister();
      }
      if (!authed) return go('#/login');
      if (parts[0] === 'help') return viewHelp();
      if (parts[0] === 'cars' && parts[1]) {
        const id = decodeURIComponent(parts[1]);
        const sec = parts[2] || 'card';
        const views = { card: viewCar, repairs: viewRepairs, refuels: viewRefuels, search: viewSearch, summary: viewSummary };
        if (!views[sec]) return go(`#/cars/${id}`);
        return await views[sec](id, query);
      }
      if (parts[0] === 'cars') return await viewCars(query);
      return go('#/cars');
    } catch (e) {
      if (seq !== renderSeq) return;
      if (e && (e.status === 0 || e.status >= 500)) return viewOffline(e);
      handleError(e);
    } finally { if (seq === renderSeq) document.body.classList.remove('loading'); }
  }

  function sessionExpired() {
    if (!API.token.get() && !state.user) return;
    API.token.set(null); state.user = null; state.cars = [];
    state.flash = 'Сеанс завершён, войдите снова';
    go('#/login');
  }

  function handleError(e) {
    if (e && e.status === 401) return sessionExpired();
    if (e && e.status === 404) { toast('Запись не найдена — возможно, она уже удалена'); return go('#/cars'); }
    console.error(e);
    toast((e && e.message) || 'Не удалось выполнить действие');
  }

  /* Сервер не отвечает или вернул 5xx при загрузке экрана */
  function viewOffline(e) {
    document.title = 'Сервер недоступен — Бортовой журнал';
    const maint = e && e.status === 503;
    root.innerHTML = `<main class="offline"><div class="empty">${icon(maint ? 'wrench' : 'alert')}
      <h1>${maint ? 'Идут технические работы' : 'Сервер не отвечает'}</h1>
      <p>${maint ? 'Журнал скоро снова заработает. Ваши данные сохранены.' : esc(e.message || 'Не удалось загрузить данные.') + ' Ваши данные на сервере не потеряны.'}</p>
      <button class="btn btn-primary" data-retry>Повторить</button></div></main>`;
    root.querySelector('[data-retry]').addEventListener('click', render);
  }

  /* Блокирует кнопку отправки, пока идёт запрос: защита от двойного сохранения */
  async function submitting(form, fn) {
    const btns = [...form.querySelectorAll('button[type=submit]')].concat(form.id ? [...document.querySelectorAll(`button[form="${form.id}"]`)] : []);
    if (btns.some((b) => b.disabled)) return;
    btns.forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
    try { await fn(); } finally { btns.forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); }); }
  }
  /* Ошибка в форме: 401 — на вход, остальное — под полями */
  function formError(form, err) { if (err && err.status === 401) return sessionExpired(); showErrors(form, err); }

  const sameId = (a, b) => String(a) === String(b);
  const toId = (v) => { const s = String(v == null ? '' : v).trim(); return s === '' ? null : /^\d+$/.test(s) ? Number(s) : s; };
  const setTitle = (t) => { document.title = t ? `${t} — Бортовой журнал` : 'Бортовой журнал автомобилиста'; };

  /* Кнопка «Показать ещё» для длинных журналов */
  function moreButton(total, shown, step) {
    const rest = total - shown;
    return rest > 0 ? `<div style="text-align:center;margin-top:14px"><button class="btn" data-more>Показать ещё ${Math.min(step, rest)} из ${rest}</button></div>` : '';
  }
  function wireMore(base, q, limit, step) {
    const b = root.querySelector('[data-more]');
    if (b) b.addEventListener('click', () => { const p = new URLSearchParams({ ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)), limit: limit + step }); go(`${base}?${p}`); });
  }

  /* ---------------- Каркас ---------------- */
  const SECTIONS = [
    ['card', 'Карточка', 'gauge', ''],
    ['repairs', 'Ремонты', 'wrench', '/repairs'],
    ['refuels', 'Заправки', 'fuel', '/refuels'],
    ['search', 'Поиск', 'search', '/search'],
    ['summary', 'Итоги', 'chart', '/summary']
  ];
  const carName = (c) => `${c.brand} ${c.model}`;

  function shell({ car, section, mobileTitle }, content) {
    setTitle(mobileTitle || (car ? carName(car) : ''));
    const carsNav = state.cars.map((c) => `<a class="rail-car" href="#/cars/${c.id}" ${car && car.id === c.id ? 'aria-current="page"' : ''}>
        <span class="rail-car-name">${esc(carName(c))}</span>${plate(c.plate_number)}</a>`).join('');
    const secNav = car ? `<nav class="rail-group" aria-label="Разделы автомобиля"><div class="rail-title">${esc(carName(car))}</div>
      ${SECTIONS.map(([k, t, ic, p]) => `<a class="rail-link" href="#/cars/${car.id}${p}" ${section === k ? 'aria-current="page"' : ''}>${icon(ic)}${t}</a>`).join('')}</nav>` : '';
    const carSelect = car && state.cars.length > 1 ? `<label class="visually-hidden" for="m-car">Автомобиль</label><select id="m-car">${state.cars.map((c) => `<option value="${c.id}" ${c.id === car.id ? 'selected' : ''}>${esc(carName(c))}</option>`).join('')}</select>` : '';
    root.innerHTML = `
      <div class="app">
        <aside class="rail">
          <a class="brand" href="#/cars">${brandMark()}<span class="brand-name">Бортовой журнал<small>автомобилиста</small></span></a>
          <nav class="rail-group" aria-label="Мои автомобили">
            <a class="rail-link" href="#/cars" ${section === 'cars' ? 'aria-current="page"' : ''}>${icon('garage')}Мои автомобили</a>
            ${carsNav}
          </nav>
          ${secNav}
          <div class="rail-foot">
            <a class="rail-link" href="#/help" ${section === 'help' ? 'aria-current="page"' : ''} style="padding-left:0">${icon('help')}Справка</a>
            <div><strong>${esc(state.user.name)}</strong>${esc(state.user.email)}</div>
            <button type="button" data-logout>Выйти</button>
          </div>
        </aside>
        <div class="mobile-bar">
          ${car ? `<a class="icon-btn" href="#/cars" aria-label="Мои автомобили">${icon('garage')}</a>` : brandMark()}
          <span class="title">${esc(car && state.cars.length > 1 ? (SECTIONS.find((x) => x[0] === section) || [, ''])[1] : (mobileTitle || (car ? carName(car) : 'Бортовой журнал')))}</span>
          ${carSelect}
          <a class="icon-btn" href="#/help" aria-label="Справка">${icon('help')}</a>
          <button type="button" class="icon-btn" data-logout aria-label="Выйти" title="Выйти (${esc(state.user.email)})">${icon('logout')}</button>
        </div>
        <main class="main" id="main">${maintenanceBanner()}${content}</main>
        ${car ? `<nav class="tabbar" aria-label="Разделы">${SECTIONS.map(([k, t, ic, p]) => `<a href="#/cars/${car.id}${p}" ${section === k ? 'aria-current="page"' : ''}>${icon(ic)}${t}</a>`).join('')}</nav>` : ''}
      </div>`;
    root.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', logout));
    const sel = root.querySelector('#m-car');
    if (sel) sel.addEventListener('change', () => go(`#/cars/${sel.value}${section && section !== 'card' ? '/' + section : ''}`));
    window.scrollTo(0, 0);
  }

  function brandMark() {
    return `<svg class="brand-mark" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="6" fill="#f3c623"/><path d="M9 25 13.5 9M25 25 20.5 9" stroke="#22303a" stroke-width="2.4" stroke-linecap="round"/><path d="M17 10v3M17 16v3M17 22v3" stroke="#22303a" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  }

  async function logout() {
    try { await API.logout(); } catch (e) { /* токен уже недействителен */ }
    API.token.set(null); state.user = null; state.cars = [];
    go('#/login');
  }

  const pageHead = (crumbs, title, actions) => `<div class="page-head"><div>${crumbs ? `<div class="crumbs">${crumbs}</div>` : ''}<h1>${title}</h1></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
  const getCar = async (id) => { const c = await API.car(id); const i = state.cars.findIndex((x) => x.id === c.id); if (i >= 0) state.cars[i] = c; return c; };

  /* ---------------- Вход и регистрация ---------------- */
  function authLayout(inner) {
    root.innerHTML = `<div class="auth">
      <section class="auth-side">
        <div>
          <a class="brand" href="#/login">${brandMark()}<span class="brand-name">Бортовой журнал<small>автомобилиста</small></span></a>
          <h1>Ремонты и заправки — по дате и пробегу</h1>
          <p>Записывайте, что и когда делали с машиной. Журнал сам посчитает расходы за любой период и средний расход топлива.</p>
        </div>
        <ul class="auth-points">
          <li>${icon('car')}Несколько автомобилей в одном профиле</li>
          <li>${icon('search')}Поиск по истории ремонтов</li>
          <li>${icon('chart')}Итоговые суммы и расход л/100 км</li>
        </ul>
      </section>
      <main class="auth-main">${maintenanceBanner()}${inner}</main></div>`;
  }

  function viewLogin() {
    setTitle('Вход');
    const flash = state.flash; state.flash = null;
    authLayout(`<form class="auth-form" novalidate>
      <h2>Вход</h2>
      ${flash ? `<div class="alert alert-info">${icon('alert')}<span>${esc(flash)}</span></div>` : ''}
      <div class="form-alert"></div>
      ${field({ name: 'email', label: 'E-mail', type: 'email', req: 1, attrs: 'autocomplete="email" required' })}
      ${field({ name: 'password', label: 'Пароль', type: 'password', req: 1, attrs: 'autocomplete="current-password" required' })}
      <button class="btn btn-primary btn-block" type="submit">Войти</button>
      <p class="auth-switch">Нет учётной записи? <a href="#/register">Зарегистрироваться</a></p>
      ${API.CONFIG.USE_MOCK ? '<p class="demo-hint">Демо-доступ: <code>ivan.petrov@mail.ru</code> / <code>qwerty123</code></p>' : ''}
    </form>`);
    const form = root.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await submitting(form, async () => {
        try {
          const res = await API.login({ email: fd.get('email').trim(), password: fd.get('password') });
          API.token.set(res.token); state.user = null;
          go('#/cars');
        } catch (err) { showErrors(form, err); }
      });
    });
  }

  function viewRegister() {
    setTitle('Регистрация');
    authLayout(`<form class="auth-form" novalidate>
      <h2>Регистрация</h2>
      <div class="form-alert"></div>
      ${field({ name: 'name', label: 'Имя', req: 1, attrs: 'autocomplete="name" required' })}
      ${field({ name: 'email', label: 'E-mail', type: 'email', req: 1, attrs: 'autocomplete="email" required' })}
      ${field({ name: 'password', label: 'Пароль', type: 'password', req: 1, hint: 'Не менее 8 символов', attrs: 'autocomplete="new-password" required minlength="8"' })}
      <button class="btn btn-primary btn-block" type="submit">Зарегистрироваться</button>
      <p class="form-note">Регистрируясь, вы соглашаетесь на обработку e-mail и имени для работы журнала.</p>
      <p class="auth-switch">Уже есть учётная запись? <a href="#/login">Войти</a></p>
    </form>`);
    const form = root.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await submitting(form, async () => {
        try {
          const res = await API.register({ name: fd.get('name').trim(), email: fd.get('email').trim(), password: fd.get('password') });
          API.token.set(res.token); state.user = null;
          go('#/cars');
        } catch (err) { showErrors(form, err); }
      });
    });
  }

  /* ---------------- Список автомобилей ---------------- */
  async function viewCars() {
    await refreshCars();
    const list = state.cars.length ? `<div class="garage">${state.cars.map((c) => `
      <article class="garage-card">
        <div class="garage-card-top">
          <div><h2><a href="#/cars/${c.id}">${esc(carName(c))}</a></h2><div class="year">${c.year} год выпуска</div></div>
          ${plate(c.plate_number)}
        </div>
        <div class="garage-km num">${UI.group(c.current_mileage)} <small>км</small></div>
        <div class="garage-stats">
          <span><b>${c.repairs_count}</b> ${plural(c.repairs_count, 'ремонт', 'ремонта', 'ремонтов')}</span>
          <span><b>${c.refuels_count}</b> ${plural(c.refuels_count, 'заправка', 'заправки', 'заправок')}</span>
          <span>${c.last_record_date ? 'запись от ' + date(c.last_record_date) : 'записей нет'}</span>
        </div>
        <div class="garage-card-foot">
          <a class="btn" href="#/cars/${c.id}">Открыть журнал</a>
          <button class="icon-btn" data-edit="${c.id}" aria-label="Изменить ${esc(carName(c))}">${icon('edit')}</button>
          <button class="icon-btn" data-del="${c.id}" aria-label="Удалить ${esc(carName(c))}">${icon('trash')}</button>
        </div>
      </article>`).join('')}</div>`
      : `<div class="empty">${icon('car')}<h2>В гараже пока пусто</h2><p>Добавьте автомобиль, чтобы вести журнал ремонтов и заправок.</p><button class="btn btn-primary" data-add>${icon('plus')}Добавить автомобиль</button></div>`;
    shell({ section: 'cars', mobileTitle: 'Мои автомобили' }, `
      ${pageHead('', 'Мои автомобили', state.cars.length ? `<button class="btn btn-primary" data-add>${icon('plus')}Добавить автомобиль</button>` : '')}
      ${list}`);
    root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => carForm()));
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => carForm(state.cars.find((c) => sameId(c.id, b.dataset.edit)))));
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteCar(state.cars.find((c) => sameId(c.id, b.dataset.del)))));
  }

  async function deleteCar(c) {
    const n = c.repairs_count + c.refuels_count;
    const ok = await confirmDialog({
      title: 'Удалить автомобиль?',
      text: `${esc(carName(c))} ${plate(c.plate_number)} будет удалён вместе со всеми записями: ${c.repairs_count} ${plural(c.repairs_count, 'ремонт', 'ремонта', 'ремонтов')} и ${c.refuels_count} ${plural(c.refuels_count, 'заправка', 'заправки', 'заправок')}. Восстановить их будет нельзя.`,
      action: n ? 'Удалить вместе с записями' : 'Удалить'
    });
    if (!ok) return;
    try { await API.deleteCar(c.id); await refreshCars(); toast('Автомобиль удалён'); go('#/cars'); } catch (e) { handleError(e); }
  }

  function carForm(car) {
    const y = new Date().getFullYear();
    const m = modal({
      title: car ? 'Изменить автомобиль' : 'Новый автомобиль',
      body: `<form class="form-stack" novalidate id="car-form">
        <div class="form-alert"></div>
        <div class="grid-2 keep">
          ${field({ name: 'brand', label: 'Марка', req: 1, value: car ? car.brand : '', attrs: 'placeholder="Lada"' })}
          ${field({ name: 'model', label: 'Модель', req: 1, value: car ? car.model : '', attrs: 'placeholder="Vesta"' })}
        </div>
        <div class="grid-2 keep">
          ${field({ name: 'year', label: 'Год выпуска', type: 'number', req: 1, value: car ? car.year : '', attrs: `inputmode="numeric" min="1900" max="${y}" placeholder="${y - 5}"` })}
          ${field({ name: 'plate_number', label: 'Гос. номер', req: 1, value: car ? car.plate_number : '', attrs: 'placeholder="А123ВС77" autocapitalize="characters"' })}
        </div>
        ${field({ name: 'vin', label: 'VIN', value: car && car.vin ? car.vin : '', hint: 'Необязательно. 17 символов', attrs: 'maxlength="17" autocapitalize="characters"' })}
        ${field({ name: 'initial_mileage', label: 'Пробег на момент добавления', type: 'text', req: 1, suffix: 'км', value: car ? car.initial_mileage : '', hint: 'С этого значения начнётся журнал', attrs: 'inputmode="numeric" placeholder="45000"' })}
        <p class="form-note"><span class="req" style="color:var(--danger)">*</span> — обязательные поля</p>
      </form>`,
      foot: `<button class="btn" data-close>Отмена</button><button class="btn btn-primary" type="submit" form="car-form">${car ? 'Сохранить' : 'Добавить автомобиль'}</button>`
    });
    const form = m.el.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = { brand: fd.get('brand').trim(), model: fd.get('model').trim(), year: toInt(fd.get('year')), plate_number: fd.get('plate_number'), vin: fd.get('vin').trim() || null, initial_mileage: toInt(fd.get('initial_mileage')) };
      await submitting(form, async () => {
        try {
          const saved = car ? await API.updateCar(car.id, body) : await API.createCar(body);
          m.close(); await refreshCars();
          toast(car ? 'Изменения сохранены' : 'Автомобиль добавлен');
          go(car ? location.hash : `#/cars/${encodeURIComponent(saved.id)}`);
        } catch (err) { formError(form, err); }
      });
    });
  }

  const toInt = (v) => { const s = String(v || '').replace(/\s/g, ''); return /^-?\d+$/.test(s) ? Number(s) : null; };
  const toNum = (v) => { const s = String(v || '').replace(/\s/g, '').replace(',', '.'); return s !== '' && !isNaN(Number(s)) ? Number(s) : null; };

  /* ---------------- Карточка автомобиля ---------------- */
  async function viewCar(id) {
    const car = await getCar(id);
    const t = today(), mStart = t.slice(0, 8) + '01', yStart = t.slice(0, 5) + '01-01';
    const [month, year, recs] = await Promise.all([
      API.summary(id, { date_from: mStart, date_to: t }), API.summary(id, { date_from: yStart, date_to: t }), API.records(id, { limit: 6 })
    ]);
    const monthLabel = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'][Number(t.slice(5, 7)) - 1];
    const track = recs.items.length ? `<ol class="track">${recs.items.map((r) => `
        <li><span class="km num">${UI.group(r.mileage)}<small>${date(r.date)}</small></span><span class="dot ${r.type === 'refuel' ? 'fuel' : ''}" aria-hidden="true"></span>
        <span class="what">${esc(r.title)}<small>${r.type === 'refuel' ? 'Заправка, ' + esc(r.category) : 'Ремонт: ' + esc(r.category)}</small></span><span class="sum num">${money(r.amount)}</span></li>`).join('')}</ol>`
      : `<div class="empty" style="border:0;padding:20px">${icon('road')}<p>Записей пока нет. Начните с ближайшей заправки или ремонта.</p></div>`;
    shell({ car, section: 'card' }, `
      <section class="car-hero">
        <div>
          <div class="car-hero-id"><h1>${esc(carName(car))}</h1>${plate(car.plate_number, true)}</div>
          ${odometer(car.current_mileage)}
          <p class="car-hero-meta">${car.last_record_date ? `Текущий пробег по записи от ${dateLong(car.last_record_date)}` : 'Пробег на момент добавления. Записей пока нет'}</p>
        </div>
        <div class="quick">
          <button class="btn btn-fuel" data-new-refuel>${icon('fuel')}Добавить заправку</button>
          <button class="btn btn-primary" data-new-repair>${icon('wrench')}Добавить ремонт</button>
        </div>
      </section>
      <section class="figures" aria-label="Показатели">
        <div class="figure"><div class="figure-label">Расходы за ${monthLabel}</div><div class="figure-value num">${money(month.total, false)}</div><div class="figure-note">топливо ${money(month.fuel_total, false)}</div></div>
        <div class="figure"><div class="figure-label">Пробег за ${monthLabel}</div><div class="figure-value num">${km(month.distance)}</div><div class="figure-note">${month.cost_per_km ? money(month.cost_per_km) + ' за км' : 'нет данных'}</div></div>
        <div class="figure"><div class="figure-label">Средний расход за ${t.slice(0, 4)} год</div><div class="figure-value num">${year.avg_consumption ? year.avg_consumption.toFixed(1).replace('.', ',') + ' л/100 км' : '—'}</div><div class="figure-note">${year.avg_consumption ? 'по заправкам до полного бака' : 'недостаточно заправок до полного бака'}</div></div>
        <div class="figure"><div class="figure-label">Всего с начала года</div><div class="figure-value num">${money(year.total, false)}</div><div class="figure-note">ремонты ${money(year.repairs_total, false)}</div></div>
      </section>
      <div class="columns">
        <section class="panel">
          <div class="panel-head"><h2>Последние записи</h2><span class="muted" style="font-size:13px">по пробегу, км</span></div>
          ${track}
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><a class="btn btn-ghost" href="#/cars/${id}/repairs">Все ремонты</a><a class="btn btn-ghost" href="#/cars/${id}/refuels">Все заправки</a></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Об автомобиле</h2><button class="icon-btn" data-edit aria-label="Изменить данные автомобиля">${icon('edit')}</button></div>
          <div class="kv">
            <div><span>Марка и модель</span><span>${esc(carName(car))}</span></div>
            <div><span>Год выпуска</span><span>${car.year}</span></div>
            <div><span>Гос. номер</span><span>${esc(car.plate_number)}</span></div>
            <div><span>VIN</span><span class="num">${car.vin ? esc(car.vin) : '—'}</span></div>
            <div><span>Начальный пробег</span><span class="num">${km(car.initial_mileage)}</span></div>
            <div><span>Записей в журнале</span><span>${car.repairs_count} ${plural(car.repairs_count, 'ремонт', 'ремонта', 'ремонтов')}, ${car.refuels_count} ${plural(car.refuels_count, 'заправка', 'заправки', 'заправок')}</span></div>
          </div>
          <button class="btn btn-ghost" style="color:var(--danger);margin-top:10px;padding-left:0" data-del>${icon('trash')}Удалить автомобиль</button>
        </section>
      </div>`);
    spinOdometers(root);
    root.querySelector('[data-new-refuel]').addEventListener('click', () => refuelForm(car));
    root.querySelector('[data-new-repair]').addEventListener('click', () => repairForm(car));
    root.querySelector('[data-edit]').addEventListener('click', () => carForm(car));
    root.querySelector('[data-del]').addEventListener('click', () => deleteCar(car));
  }

  /* Подсказка о допустимом пробеге для выбранной даты (метод 13) */
  function wireMileageHint(form, car, exType, exId) {
    const d = form.querySelector('[name=date]'), hint = form.querySelector('#f-mileage-hint');
    const upd = async () => {
      if (!d.value) { hint.textContent = ''; return; }
      try {
        const rg = await API.mileageRange(car.id, { date: d.value, exclude_type: exType, exclude_id: exId });
        hint.textContent = rg.max === null ? `Не меньше ${km(rg.min)}` : `От ${km(rg.min)} до ${km(rg.max)} — между соседними записями`;
      } catch (e) { hint.textContent = ''; }
    };
    d.addEventListener('change', upd); upd();
  }

  /* ---------------- Форма ремонта ---------------- */
  function repairForm(car, rec, after) {
    const cats = state.categories.map((c) => `<option value="${c.id}" ${rec && sameId(rec.category.id, c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const m = modal({
      title: rec ? 'Изменить ремонт' : 'Новый ремонт',
      body: `<form class="form-stack" novalidate id="repair-form">
        <div class="form-alert"></div>
        <div class="grid-2 keep">
          ${field({ name: 'date', label: 'Дата', type: 'date', req: 1, value: rec ? rec.date : today(), attrs: `max="${today()}"` })}
          ${field({ name: 'mileage', label: 'Пробег', req: 1, suffix: 'км', value: rec ? rec.mileage : '', attrs: `inputmode="numeric" placeholder="${car.current_mileage}"` })}
        </div>
        ${field({ name: 'category_id', label: 'Категория работ', req: 1, options: `<option value="">Выберите категорию</option>${cats}` })}
        ${field({ name: 'description', label: 'Что сделано', type: 'textarea', req: 1, rows: 2, value: rec ? rec.description : '', attrs: 'placeholder="Замена масла и масляного фильтра"' })}
        ${field({ name: 'place', label: 'Где (СТО)', value: rec ? rec.place : '', attrs: 'placeholder="СТО «Мотор», Варшавское ш., 118"' })}
        <div class="grid-2 keep">
          ${field({ name: 'labor_cost', label: 'Работы', req: 1, suffix: '₽', value: rec ? rec.labor_cost : '', attrs: 'inputmode="decimal" placeholder="0"' })}
          ${field({ name: 'parts_cost', label: 'Запчасти', req: 1, suffix: '₽', value: rec ? rec.parts_cost : '', attrs: 'inputmode="decimal" placeholder="0"' })}
        </div>
        <div class="calc repair"><span>Итого за ремонт</span><strong class="num" data-total>${money(0)}</strong></div>
      </form>`,
      foot: `${rec ? `<button class="btn btn-ghost spacer" style="color:var(--danger)" data-delete>${icon('trash')}Удалить</button>` : ''}<button class="btn" data-close>Отмена</button><button class="btn btn-primary" type="submit" form="repair-form">${rec ? 'Сохранить' : 'Добавить ремонт'}</button>`
    });
    const form = m.el.querySelector('form');
    const total = form.querySelector('[data-total]');
    const recalc = () => { total.textContent = money((toNum(form.labor_cost.value) || 0) + (toNum(form.parts_cost.value) || 0), true); };
    form.addEventListener('input', recalc); recalc();
    wireMileageHint(form, car, rec ? 'repair' : undefined, rec ? rec.id : undefined);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { date: form.date.value, mileage: toInt(form.mileage.value), category_id: toId(form.category_id.value), description: form.description.value, place: form.place.value, labor_cost: toNum(form.labor_cost.value), parts_cost: toNum(form.parts_cost.value) };
      await submitting(form, async () => {
        try {
          rec ? await API.updateRepair(car.id, rec.id, body) : await API.createRepair(car.id, body);
          m.close(); toast(rec ? 'Изменения сохранены' : 'Ремонт добавлен'); after ? after() : render();
        } catch (err) { formError(form, err); }
      });
    });
    const del = m.el.querySelector('[data-delete]');
    if (del) del.addEventListener('click', async () => { m.close(); await removeRepair(car, rec, after); });
    return m;
  }
  async function removeRepair(car, r, after) {
    if (!await confirmDialog({ title: 'Удалить запись о ремонте?', text: `«${esc(r.description)}» от ${date(r.date)} на ${money(r.total_cost)}. Сумма исчезнет из итогов.`, action: 'Удалить запись' })) return;
    try { await API.deleteRepair(car.id, r.id); toast('Запись удалена'); after ? after() : render(); } catch (e) { handleError(e); }
  }

  /* ---------------- Форма заправки ---------------- */
  function refuelForm(car, rec, after) {
    const last = rec ? null : state.lastFuel && state.lastFuel[car.id];
    const def = state.fuelTypes.find((f) => f.name === 'АИ-95') || state.fuelTypes[0] || {};
    const fuelSel = rec ? rec.fuel_type.id : last ? last.fuel_type_id : def.id;
    const opts = state.fuelTypes.map((f) => `<option value="${f.id}" ${sameId(f.id, fuelSel) ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    const m = modal({
      title: rec ? 'Изменить заправку' : 'Новая заправка',
      body: `<form class="form-stack" novalidate id="refuel-form">
        <div class="form-alert"></div>
        <div class="grid-2 keep">
          ${field({ name: 'date', label: 'Дата', type: 'date', req: 1, value: rec ? rec.date : today(), attrs: `max="${today()}"` })}
          ${field({ name: 'mileage', label: 'Пробег', req: 1, suffix: 'км', value: rec ? rec.mileage : '', attrs: `inputmode="numeric" placeholder="${car.current_mileage}"` })}
        </div>
        <div class="grid-2 keep">
          ${field({ name: 'fuel_type_id', label: 'Топливо', req: 1, options: opts })}
          ${field({ name: 'station', label: 'АЗС', value: rec ? rec.station : last ? last.station : '', attrs: 'placeholder="Лукойл, Каширское ш., 61"' })}
        </div>
        <div class="grid-2 keep">
          ${field({ name: 'volume', label: 'Объём', req: 1, suffix: 'л', value: rec ? String(rec.volume).replace('.', ',') : '', attrs: 'inputmode="decimal" placeholder="40,00"' })}
          ${field({ name: 'price_per_liter', label: 'Цена за литр', req: 1, suffix: '₽', value: rec ? String(rec.price_per_liter).replace('.', ',') : last ? String(last.price_per_liter).replace('.', ',') : '', attrs: 'inputmode="decimal" placeholder="59,90"' })}
        </div>
        <div><label class="check"><input type="checkbox" name="full_tank" ${!rec || rec.full_tank ? 'checked' : ''}> Заправлен полный бак</label><p class="hint" style="margin-left:28px">Отмечайте, если заливали до полного: по таким заправкам считается расход</p></div>
        <div class="calc"><span>Сумма заправки</span><strong class="num" data-total>${money(0, true)}</strong></div>
      </form>`,
      foot: `${rec ? `<button class="btn btn-ghost spacer" style="color:var(--danger)" data-delete>${icon('trash')}Удалить</button>` : ''}<button class="btn" data-close>Отмена</button><button class="btn btn-primary" type="submit" form="refuel-form">${rec ? 'Сохранить' : 'Добавить заправку'}</button>`
    });
    const form = m.el.querySelector('form');
    const total = form.querySelector('[data-total]');
    const recalc = () => { const v = toNum(form.volume.value) || 0, p = toNum(form.price_per_liter.value) || 0; total.textContent = money(Math.round(v * p * 100) / 100, true); };
    form.addEventListener('input', recalc); recalc();
    wireMileageHint(form, car, rec ? 'refuel' : undefined, rec ? rec.id : undefined);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { date: form.date.value, mileage: toInt(form.mileage.value), fuel_type_id: toId(form.fuel_type_id.value), station: form.station.value, volume: toNum(form.volume.value), price_per_liter: toNum(form.price_per_liter.value), full_tank: form.full_tank.checked };
      await submitting(form, async () => {
        try {
          rec ? await API.updateRefuel(car.id, rec.id, body) : await API.createRefuel(car.id, body);
          m.close(); toast(rec ? 'Изменения сохранены' : 'Заправка добавлена'); after ? after() : render();
        } catch (err) { formError(form, err); }
      });
    });
    const del = m.el.querySelector('[data-delete]');
    if (del) del.addEventListener('click', async () => { m.close(); await removeRefuel(car, rec, after); });
    return m;
  }
  async function removeRefuel(car, r, after) {
    if (!await confirmDialog({ title: 'Удалить запись о заправке?', text: `Заправка от ${date(r.date)}: ${liters(r.volume)} на ${money(r.amount)}. Сумма исчезнет из итогов, средний расход будет пересчитан.`, action: 'Удалить запись' })) return;
    try { await API.deleteRefuel(car.id, r.id); toast('Запись удалена'); after ? after() : render(); } catch (e) { handleError(e); }
  }

  /* ---------------- Журнал ремонтов ---------------- */
  async function viewRepairs(id, query) {
    const car = await getCar(id);
    const q = { category_id: query.category_id || '', date_from: query.date_from || '', date_to: query.date_to || '', sort: query.sort || 'date_desc' };
    const limit = Math.min(Number(query.limit) || 50, 10000);
    const res = await API.repairs(id, { ...q, limit });
    const catOpts = `<option value="">Все категории</option>` + state.categories.map((c) => `<option value="${c.id}" ${String(c.id) === q.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const rows = res.items.map((r) => `<tr>
        <td class="num">${date(r.date)}</td><td class="num r">${UI.group(r.mileage)}</td><td><span class="tag">${esc(r.category.name)}</span></td>
        <td class="desc">${esc(r.description)}<small>${esc(r.place)}</small></td>
        <td class="num r">${money(r.labor_cost, false)}</td><td class="num r">${money(r.parts_cost, false)}</td><td class="num r"><b>${money(r.total_cost, false)}</b></td>
        <td class="act"><button class="icon-btn" data-edit="${r.id}" aria-label="Изменить запись от ${date(r.date)}">${icon('edit')}</button><button class="icon-btn" data-del="${r.id}" aria-label="Удалить запись от ${date(r.date)}">${icon('trash')}</button></td></tr>`).join('');
    const cards = res.items.map((r) => `<article class="rec"><div class="rec-top"><span><b>${date(r.date)}</b></span><span class="num">${km(r.mileage)}</span></div>
        <div class="rec-title">${esc(r.description)}</div><div class="rec-sub">${esc(r.place)}</div>
        <div class="rec-bottom"><span class="tag">${esc(r.category.name)}</span><span class="rec-sum num">${money(r.total_cost, false)}</span></div>
        <div class="rec-bottom"><span class="muted" style="font-size:12px">работы ${money(r.labor_cost, false)}, запчасти ${money(r.parts_cost, false)}</span><span><button class="icon-btn" data-edit="${r.id}" aria-label="Изменить">${icon('edit')}</button><button class="icon-btn" data-del="${r.id}" aria-label="Удалить">${icon('trash')}</button></span></div></article>`).join('');
    const body = res.items.length ? `
      <div class="table-wrap"><table class="log"><thead><tr><th>Дата</th><th class="r">Пробег, км</th><th>Категория</th><th>Что сделано</th><th class="r">Работы</th><th class="r">Запчасти</th><th class="r">Итого</th><th><span class="visually-hidden">Действия</span></th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td colspan="4">${res.total_count} ${plural(res.total_count, 'запись', 'записи', 'записей')}</td><td class="num r">${money(res.sum.labor_cost, false)}</td><td class="num r">${money(res.sum.parts_cost, false)}</td><td class="num r">${money(res.sum.total_cost, false)}</td><td></td></tr></tfoot></table></div>
      <div class="cards">${cards}<div class="cards-total"><span>${res.total_count} ${plural(res.total_count, 'запись', 'записи', 'записей')}</span><span class="num">${money(res.sum.total_cost, false)}</span></div></div>${moreButton(res.total_count, res.items.length, 50)}`
      : `<div class="empty">${icon('wrench')}<h2>${q.category_id || q.date_from || q.date_to ? 'Ничего не найдено' : 'Ремонтов пока нет'}</h2><p>${q.category_id || q.date_from || q.date_to ? 'Измените категорию или период.' : 'Добавьте первую запись: замену масла, шиномонтаж или любой другой ремонт.'}</p></div>`;
    shell({ car, section: 'repairs', mobileTitle: 'Журнал ремонтов' }, `
      ${pageHead(`<a href="#/cars/${id}">${esc(carName(car))}</a>`, 'Журнал ремонтов', `<a class="btn hide-m" href="#/cars/${id}/search">${icon('search')}Поиск</a><button class="btn btn-primary" data-new>${icon('plus')}Добавить ремонт</button>`)}
      <form class="toolbar" data-filter>
        ${field({ prefix: 'flt-', name: 'category_id', label: 'Категория', options: catOpts })}
        ${field({ prefix: 'flt-', name: 'date_from', label: 'С даты', type: 'date', value: q.date_from })}
        ${field({ prefix: 'flt-', name: 'date_to', label: 'По дату', type: 'date', value: q.date_to })}
        ${field({ prefix: 'flt-', name: 'sort', label: 'Порядок', options: `<option value="date_desc" ${q.sort === 'date_desc' ? 'selected' : ''}>Сначала новые</option><option value="date_asc" ${q.sort === 'date_asc' ? 'selected' : ''}>Сначала старые</option><option value="cost_desc" ${q.sort === 'cost_desc' ? 'selected' : ''}>Сначала дорогие</option>` })}
      </form>
      ${body}`);
    wireFilter(`#/cars/${id}/repairs`);
    wireMore(`#/cars/${id}/repairs`, q, limit, 50);
    root.querySelector('[data-new]').addEventListener('click', () => repairForm(car));
    const byId = (x) => res.items.find((r) => sameId(r.id, x));
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => repairForm(car, byId(b.dataset.edit))));
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => removeRepair(car, byId(b.dataset.del))));
  }

  function wireFilter(base) {
    const f = root.querySelector('[data-filter]');
    f.querySelectorAll('.field .hint, .field .error').forEach((x) => x.remove());
    f.addEventListener('change', () => {
      const params = new URLSearchParams([...new FormData(f)].filter(([, v]) => v !== ''));
      go(base + (params.toString() ? '?' + params : ''));
    });
    f.addEventListener('submit', (e) => e.preventDefault());
  }

  /* ---------------- Журнал заправок ---------------- */
  async function viewRefuels(id, query) {
    const car = await getCar(id);
    const q = { fuel_type_id: query.fuel_type_id || '', date_from: query.date_from || '', date_to: query.date_to || '' };
    const limit = Math.min(Number(query.limit) || 25, 10000);
    const res = await API.refuels(id, { ...q, limit });
    if (res.items[0]) { state.lastFuel = state.lastFuel || {}; state.lastFuel[id] = { fuel_type_id: res.items[0].fuel_type.id, station: res.items[0].station, price_per_liter: res.items[0].price_per_liter }; }
    const fOpts = `<option value="">Любое топливо</option>` + state.fuelTypes.map((f) => `<option value="${f.id}" ${String(f.id) === q.fuel_type_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    const full = `<span class="full-mark">${icon('check')}полный</span>`;
    const rows = res.items.map((r) => `<tr>
        <td class="num">${date(r.date)}</td><td class="num r">${UI.group(r.mileage)}</td><td>${esc(r.station)}</td><td><span class="tag fuel">${esc(r.fuel_type.name)}</span></td>
        <td class="num r">${liters(r.volume)}</td><td class="num r">${money(r.price_per_liter, true)}</td><td class="num r"><b>${money(r.amount, true)}</b></td><td>${r.full_tank ? full : '<span class="muted" style="font-size:12px">долив</span>'}</td>
        <td class="act"><button class="icon-btn" data-edit="${r.id}" aria-label="Изменить заправку от ${date(r.date)}">${icon('edit')}</button><button class="icon-btn" data-del="${r.id}" aria-label="Удалить заправку от ${date(r.date)}">${icon('trash')}</button></td></tr>`).join('');
    const cards = res.items.map((r) => `<article class="rec"><div class="rec-top"><span><b>${date(r.date)}</b></span><span class="num">${km(r.mileage)}</span></div>
        <div class="rec-title">${esc(r.station)}</div>
        <div class="rec-bottom"><span><span class="tag fuel">${esc(r.fuel_type.name)}</span> <span class="num" style="font-size:13px">${liters(r.volume)} × ${money(r.price_per_liter, true)}</span></span><span class="rec-sum num">${money(r.amount, true)}</span></div>
        <div class="rec-bottom">${r.full_tank ? full : '<span class="muted" style="font-size:12px">долив</span>'}<span><button class="icon-btn" data-edit="${r.id}" aria-label="Изменить">${icon('edit')}</button><button class="icon-btn" data-del="${r.id}" aria-label="Удалить">${icon('trash')}</button></span></div></article>`).join('');
    const more = moreButton(res.total_count, res.items.length, 25);
    const body = res.items.length ? `
      <div class="table-wrap"><table class="log"><thead><tr><th>Дата</th><th class="r">Пробег, км</th><th>АЗС</th><th>Топливо</th><th class="r">Объём</th><th class="r">Цена за литр</th><th class="r">Сумма</th><th>Бак</th><th><span class="visually-hidden">Действия</span></th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td colspan="4">${res.total_count} ${plural(res.total_count, 'заправка', 'заправки', 'заправок')} за выбранный период</td><td class="num r">${liters(res.sum.volume)}</td><td></td><td class="num r">${money(res.sum.amount, true)}</td><td colspan="2"></td></tr></tfoot></table></div>
      <div class="cards">${cards}<div class="cards-total"><span>${res.total_count} ${plural(res.total_count, 'заправка', 'заправки', 'заправок')}</span><span class="num">${money(res.sum.amount, false)}</span></div></div>${more}`
      : `<div class="empty">${icon('fuel')}<h2>${q.fuel_type_id || q.date_from || q.date_to ? 'Ничего не найдено' : 'Заправок пока нет'}</h2><p>${q.fuel_type_id || q.date_from || q.date_to ? 'Измените вид топлива или период.' : 'Записывайте каждую заправку — так журнал посчитает средний расход.'}</p></div>`;
    shell({ car, section: 'refuels', mobileTitle: 'Журнал заправок' }, `
      ${pageHead(`<a href="#/cars/${id}">${esc(carName(car))}</a>`, 'Журнал заправок', `<button class="btn btn-primary" data-new>${icon('plus')}Добавить заправку</button>`)}
      <form class="toolbar" data-filter>
        ${field({ prefix: 'flt-', name: 'fuel_type_id', label: 'Топливо', options: fOpts })}
        ${field({ prefix: 'flt-', name: 'date_from', label: 'С даты', type: 'date', value: q.date_from })}
        ${field({ prefix: 'flt-', name: 'date_to', label: 'По дату', type: 'date', value: q.date_to })}
      </form>
      ${body}`);
    wireFilter(`#/cars/${id}/refuels`);
    root.querySelector('[data-new]').addEventListener('click', () => refuelForm(car));
    wireMore(`#/cars/${id}/refuels`, q, limit, 25);
    const byId = (x) => res.items.find((r) => sameId(r.id, x));
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => refuelForm(car, byId(b.dataset.edit))));
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => removeRefuel(car, byId(b.dataset.del))));
  }

  /* ---------------- Поиск по ремонтам ---------------- */
  async function viewSearch(id, query) {
    const car = await getCar(id);
    const q = { q: query.q || '', category_id: query.category_id || '', date_from: query.date_from || '', date_to: query.date_to || '', mileage_from: query.mileage_from || '', mileage_to: query.mileage_to || '' };
    const active = Object.values(q).some(Boolean);
    const limit = Math.min(Number(query.limit) || 50, 10000);
    const res = await API.repairs(id, { ...q, limit });
    const catOpts = `<option value="">Все категории</option>` + state.categories.map((c) => `<option value="${c.id}" ${String(c.id) === q.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const hl = (s) => { const t = esc(s); if (!q.q.trim()) return t; const needle = esc(q.q.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return t.replace(new RegExp(needle, 'gi'), (x) => `<mark>${x}</mark>`); };
    const items = res.items.map((r) => `<article class="rec">
        <div class="rec-top"><span><b>${date(r.date)}</b>, ${km(r.mileage)}</span><span class="tag">${esc(r.category.name)}</span></div>
        <div class="rec-title">${hl(r.description)}</div><div class="rec-sub">${hl(r.place)}</div>
        <div class="rec-bottom"><span class="muted" style="font-size:13px">работы ${money(r.labor_cost, false)}, запчасти ${money(r.parts_cost, false)}</span><span class="rec-sum num" style="font-weight:700">${money(r.total_cost, false)}</span></div></article>`).join('');
    shell({ car, section: 'search', mobileTitle: 'Поиск по ремонтам' }, `
      ${pageHead(`<a href="#/cars/${id}">${esc(carName(car))}</a>`, 'Поиск по ремонтам', '')}
      <div class="search-layout">
        <form class="panel filters" data-search novalidate>
          <div class="form-stack">
            ${field({ prefix: 'flt-', name: 'q', label: 'Текст в описании или месте', type: 'search', value: q.q, attrs: 'placeholder="колодки, масло, «Мотор»"' })}
            ${field({ prefix: 'flt-', name: 'category_id', label: 'Категория', options: catOpts })}
            <div class="grid-2 keep">${field({ prefix: 'flt-', name: 'date_from', label: 'С даты', type: 'date', value: q.date_from })}${field({ prefix: 'flt-', name: 'date_to', label: 'По дату', type: 'date', value: q.date_to })}</div>
            <div class="grid-2 keep">${field({ prefix: 'flt-', name: 'mileage_from', label: 'Пробег от', suffix: 'км', value: q.mileage_from, attrs: 'inputmode="numeric"' })}${field({ prefix: 'flt-', name: 'mileage_to', label: 'Пробег до', suffix: 'км', value: q.mileage_to, attrs: 'inputmode="numeric"' })}</div>
            <div style="display:flex;gap:8px"><button class="btn btn-primary" style="flex:1" type="submit">${icon('search')}Найти</button>${active ? `<a class="btn" href="#/cars/${id}/search">Сбросить</a>` : ''}</div>
          </div>
        </form>
        <section>
          <div class="result-bar"><span>${active ? 'Найдено' : 'Все ремонты'}: ${res.total_count} ${plural(res.total_count, 'запись', 'записи', 'записей')}</span><strong class="num">${money(res.sum.total_cost, false)}</strong></div>
          ${res.items.length ? `<div class="result-list">${items}</div>${moreButton(res.total_count, res.items.length, 50)}` : `<div class="empty">${icon('search')}<h2>Ничего не найдено</h2><p>Попробуйте другое слово или расширьте период и диапазон пробега.</p></div>`}
        </section>
      </div>`);
    wireMore(`#/cars/${id}/search`, q, limit, 50);
    const f = root.querySelector('[data-search]');
    f.querySelectorAll('.hint, .error').forEach((x) => x.remove());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = new URLSearchParams([...new FormData(f)].map(([k, v]) => [k, String(v).trim().replace(/\s/g, k.startsWith('mileage') ? '' : ' ')]).filter(([, v]) => v !== ''));
      go(`#/cars/${id}/search${p.toString() ? '?' + p : ''}`);
    });
  }

  /* ---------------- Итоги ---------------- */
  function presetRange(p) {
    const t = today(), y = Number(t.slice(0, 4));
    if (p === 'month') return { date_from: t.slice(0, 8) + '01', date_to: t };
    if (p === 'year') return { date_from: `${y}-01-01`, date_to: t };
    if (p === 'lastyear') return { date_from: `${y - 1}-01-01`, date_to: `${y - 1}-12-31` };
    return {};
  }
  async function viewSummary(id, query) {
    const car = await getCar(id);
    const preset = query.preset || (query.date_from || query.date_to ? 'custom' : 'year');
    const range = preset === 'custom' ? { date_from: query.date_from || '', date_to: query.date_to || '' } : presetRange(preset);
    const s = await API.summary(id, range);
    const y = today().slice(0, 4);
    const presets = [['month', 'Этот месяц'], ['year', `${y} год`], ['lastyear', `${y - 1} год`], ['all', 'Всё время'], ['custom', 'Свой период']];
    const periodText = s.date_from || s.date_to ? `${s.date_from ? date(s.date_from) : 'начала'} — ${s.date_to ? date(s.date_to) : 'сегодня'}` : 'за всё время эксплуатации';
    const maxCat = Math.max(1, ...s.by_category.map((c) => c.total));
    shell({ car, section: 'summary', mobileTitle: 'Итоги' }, `
      ${pageHead(`<a href="#/cars/${id}">${esc(carName(car))}</a>`, 'Итоговые суммы', '')}
      <div class="period">
        <div class="seg" role="group" aria-label="Период">${presets.map(([k, t]) => `<button type="button" data-preset="${k}" aria-pressed="${k === preset}">${t}</button>`).join('')}</div>
        ${preset === 'custom' ? `<form class="toolbar" data-custom style="margin:0">${field({ prefix: 'flt-', name: 'date_from', label: 'С даты', type: 'date', value: range.date_from })}${field({ prefix: 'flt-', name: 'date_to', label: 'По дату', type: 'date', value: range.date_to })}</form>` : ''}
      </div>
      <p class="muted" style="margin:-8px 0 14px;font-size:14px">Период: ${periodText}</p>
      <section class="totals" aria-label="Итоги за период">
        <div class="total"><div class="total-label"><i></i>Ремонты</div><div class="total-value num">${money(s.repairs_total, true)}</div></div>
        <div class="total"><div class="total-label"><i class="fuel"></i>Топливо</div><div class="total-value num">${money(s.fuel_total, true)}</div></div>
        <div class="total grand"><div class="total-label">Всего за период</div><div class="total-value num">${money(s.total, true)}</div></div>
      </section>
      <div class="columns">
        <section class="panel chart">
          <div class="panel-head"><h2>По месяцам</h2><div class="legend"><span><i></i>Ремонты</span><span><i class="fuel"></i>Топливо</span></div></div>
          ${monthChart(s.by_month)}
        </section>
        <div style="display:flex;flex-direction:column;gap:24px">
          <section class="panel">
            <h2 style="margin-bottom:6px">Показатели</h2>
            <div class="kv">
              <div><span>Средний расход</span><b class="num">${s.avg_consumption ? s.avg_consumption.toFixed(2).replace('.', ',') + ' л/100 км' : 'Недостаточно данных'}</b></div>
              <div><span>Пробег за период</span><span class="num">${km(s.distance)}</span></div>
              <div><span>Залито топлива</span><span class="num">${liters(s.fuel_volume)}</span></div>
              <div><span>Стоимость 1 км</span><span class="num">${s.cost_per_km ? money(s.cost_per_km, true) : '—'}</span></div>
            </div>
            ${s.avg_consumption ? '' : '<p class="hint" style="margin-top:8px">Расход считается между заправками до полного бака. Нужно хотя бы две такие заправки за период.</p>'}
          </section>
          <section class="panel">
            <h2 style="margin-bottom:12px">Ремонты по категориям</h2>
            ${s.by_category.length ? `<ul class="bars">${s.by_category.map((c) => `<li><span>${esc(c.category.name)}</span><span class="track-bar"><b style="width:${(c.total / maxCat * 100).toFixed(1)}%"></b></span><span class="num">${money(c.total, false)}</span></li>`).join('')}</ul>` : '<p class="muted">Ремонтов за период не было.</p>'}
          </section>
        </div>
      </div>`);
    root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.preset;
      if (k === 'custom') { const r = presetRange('year'); go(`#/cars/${id}/summary?preset=custom&date_from=${r.date_from}&date_to=${r.date_to}`); }
      else go(`#/cars/${id}/summary?preset=${k}`);
    }));
    const cf = root.querySelector('[data-custom]');
    if (cf) {
      cf.querySelectorAll('.hint, .error').forEach((x) => x.remove());
      cf.addEventListener('change', () => {
        let a = cf.date_from.value, b = cf.date_to.value;
        if (a && b && a > b) [a, b] = [b, a];
        go(`#/cars/${id}/summary?preset=custom&date_from=${a}&date_to=${b}`);
      });
    }
  }

  function monthChart(months) {
    if (!months.length) return '<p class="muted">Нет данных за период.</p>';
    const W = 720, H = 260, L = 56, B = 28, T = 10;
    const max = Math.max(1000, ...months.map((m) => Math.max(m.repairs, m.fuel)));
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const cw = (W - L - 8) / months.length, bw = Math.max(3, Math.min(16, cw / 2 - 3));
    const yv = (v) => T + (H - T - B) * (1 - v / top);
    let g = '';
    for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - 4}" y1="${yv(v)}" y2="${yv(v)}" stroke="${v ? '#e1e6e8' : '#aab6bc'}"/><text x="${L - 8}" y="${yv(v) + 4}" text-anchor="end">${v >= 1000 ? (v / 1000) + ' тыс' : v}</text>`;
    const every = Math.ceil(months.length / 12);
    const bars = months.map((m, i) => {
      const cx = L + cw * i + cw / 2;
      const [yy, mm] = m.month.split('-');
      const lbl = i % every === 0 ? `<text x="${cx}" y="${H - 8}" text-anchor="middle">${MONTHS_SHORT[Number(mm) - 1]}${mm === '01' || i === 0 ? ' ' + yy.slice(2) : ''}</text>` : '';
      const rep = m.repairs ? `<rect x="${cx - bw - 1}" y="${yv(m.repairs)}" width="${bw}" height="${yv(0) - yv(m.repairs)}" rx="2" fill="#1b4f9c"><title>${MONTHS[Number(mm) - 1]} ${yy}, ремонты: ${money(m.repairs, false)}</title></rect>` : '';
      const fu = m.fuel ? `<rect x="${cx + 1}" y="${yv(m.fuel)}" width="${bw}" height="${yv(0) - yv(m.fuel)}" rx="2" fill="#f3c623" stroke="#b88a00" stroke-width="1"><title>${MONTHS[Number(mm) - 1]} ${yy}, топливо: ${money(m.fuel, false)}</title></rect>` : '';
      return rep + fu + lbl;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Расходы по месяцам: ремонты и топливо"><g class="axis">${g}</g><g class="axis">${bars}</g></svg>`;
  }
  function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

  /* ---------------- Справка ---------------- */
  function viewHelp() {
    const items = [
      ['С чего начать', `<ol><li>Добавьте автомобиль на странице «Мои автомобили». Укажите пробег на сегодня — с него начнётся журнал.</li><li>Откройте карточку автомобиля и записывайте заправки и ремонты кнопками в верхней части.</li><li>Смотрите расходы в разделе «Итоги».</li></ol>`],
      ['Почему журнал не принимает пробег', `<p>Записи идут по порядку: у более поздней записи пробег не может быть меньше, чем у более ранней. Под полем «Пробег» показано, какое значение подходит для выбранной даты.</p><p>Если ошиблись в старой записи, откройте её в журнале и исправьте пробег.</p>`],
      ['Как считается средний расход', `<p>Расход считается между заправками до полного бака: всё топливо, залитое после первой такой заправки, делится на проеханный путь и умножается на 100. Поэтому отмечайте «Заправлен полный бак», когда заливаете до щелчка пистолета.</p><p>Если за период меньше двух заправок до полного бака, журнал пишет «Недостаточно данных».</p>`],
      ['Как найти старый ремонт', `<p>В разделе «Поиск» введите слово из описания или название СТО, например «колодки». Можно сузить поиск категорией, периодом и диапазоном пробега. Под результатами — сумма по найденным записям.</p>`],
      ['Что будет при удалении автомобиля', `<p>Вместе с автомобилем удаляются все его ремонты и заправки. Перед удалением журнал спросит подтверждение. Восстановить данные после удаления нельзя.</p>`],
      ['Кто видит мои записи', `<p>Только вы. Каждый пользователь работает со своими автомобилями, обмена данными между пользователями нет.</p>`]
    ];
    shell({ section: 'help', mobileTitle: 'Справка' }, `
      ${pageHead('', 'Справка', '')}
      <div class="help">${items.map(([t, b], i) => `<details ${i < 2 ? 'open' : ''}><summary>${t}</summary><div>${b}</div></details>`).join('')}
      ${API.CONFIG.USE_MOCK ? `<p class="hint">Это прототип: данные хранятся только в вашем браузере. <button class="btn btn-ghost" data-reset style="min-height:auto;padding:0;vertical-align:baseline">Вернуть демо-данные</button></p>` : ''}</div>`);
    const r = root.querySelector('[data-reset]');
    if (r) r.addEventListener('click', () => { API.resetMock(); API.token.set(null); state.user = null; toast('Демо-данные восстановлены'); go('#/login'); });
  }

  /* Полоса «Идут технические работы» (ответ 503, п. 4.1.4 ТЗ) */
  let maintenanceOn = false;
  function maintenanceBanner() { return maintenanceOn ? '<div class="banner" role="status">Идут технические работы. Данные сохранены, попробуйте позже</div>' : ''; }
  window.addEventListener('bja:maintenance', (e) => {
    maintenanceOn = !!e.detail;
    document.querySelectorAll('.banner').forEach((b) => b.remove());
    const host = root.querySelector('.main, .auth-main');
    if (maintenanceOn && host) host.insertAdjacentHTML('afterbegin', maintenanceBanner());
  });
  window.addEventListener('bja:unauthorized', sessionExpired);

  window.addEventListener('hashchange', render);
  window.BJA_APP = { render, state };
  render();
})();
