/* Клиент REST API (см. docs/API.md).
   Настройки — в js/config.js:
   USE_MOCK = true  — запросы обрабатывает встроенный макет сервера, данные лежат в localStorage;
   USE_MOCK = false — запросы уходят на настоящий бэкенд по адресу BASE_URL. */
(function () {
  'use strict';

  const CONFIG = Object.assign({ USE_MOCK: true, BASE_URL: '/api/v1', MOCK_DELAY_MS: 120, TIMEOUT_MS: 15000 }, window.BJA_CONFIG || {});
  CONFIG.BASE_URL = String(CONFIG.BASE_URL).replace(/\/+$/, '');

  const STORE_KEY = 'bja-mock-db-v1';
  const TOKEN_KEY = 'bja-token';

  class ApiError extends Error {
    constructor(status, code, message, fields) {
      super(message);
      this.status = status; this.code = code; this.fields = fields || {};
    }
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно — работаем в памяти */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ничего */ } }
  };

  let memToken = store.get(TOKEN_KEY);
  const token = {
    get: () => memToken,
    set: (t) => { memToken = t; t ? store.set(TOKEN_KEY, t) : store.del(TOKEN_KEY); }
  };

  /* Уведомления для экранов: сеанс истёк, технические работы */
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  let maintenance = false;
  function setMaintenance(on) { if (on !== maintenance) { maintenance = on; emit('bja:maintenance', on); } }

  /* Денежные суммы из NUMERIC часто приходят строкой ("1250.00") — приводим к числу */
  const NUMERIC_KEYS = new Set(['amount', 'volume', 'price_per_liter', 'labor_cost', 'parts_cost', 'total_cost',
    'repairs_total', 'fuel_total', 'total', 'fuel_volume', 'avg_consumption', 'cost_per_km', 'repairs', 'fuel',
    'mileage', 'initial_mileage', 'current_mileage', 'year', 'distance', 'min', 'max', 'total_count',
    'repairs_count', 'refuels_count', 'count']);
  function normalize(v, key) {
    if (Array.isArray(v)) return v.map((x) => normalize(x));
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = normalize(v[k], k); return o; }
    if (typeof v === 'string' && NUMERIC_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    return v;
  }

  /* ---------------- Настоящий HTTP-клиент ---------------- */
  async function httpRequest(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token.get()) headers.Authorization = 'Bearer ' + token.get();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), CONFIG.TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetch(CONFIG.BASE_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl ? ctrl.signal : undefined });
    } catch (e) {
      throw new ApiError(0, 'NETWORK', 'Не удалось связаться с сервером. Проверьте подключение и повторите');
    } finally { if (timer) clearTimeout(timer); }
    if (res.status === 503) setMaintenance(true); else setMaintenance(false);
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data && data.error) || {};
      const e = new ApiError(res.status, err.code || (res.status === 503 ? 'MAINTENANCE' : 'INTERNAL_ERROR'), err.message || defaultMessage(res.status), err.fields);
      if (res.status === 401 && !/^\/auth\/(login|register)$/.test(path)) emit('bja:unauthorized');
      throw e;
    }
    return normalize(data);
  }
  function defaultMessage(status) {
    if (status === 401) return 'Сеанс завершён, войдите снова';
    if (status === 404) return 'Запись не найдена';
    if (status === 409) return 'Такие данные уже есть';
    if (status === 422 || status === 400) return 'Проверьте заполнение полей';
    if (status === 503) return 'Идут технические работы. Данные сохранены, попробуйте позже';
    return 'Ошибка сервера. Попробуйте ещё раз';
  }

  /* ---------------- Макет сервера ---------------- */
  let db = null;
  function load() {
    if (db) return db;
    const raw = store.get(STORE_KEY);
    try { db = raw ? JSON.parse(raw) : null; } catch (e) { db = null; }
    if (!db) { db = window.BJA_MOCK.build(); save(); }
    return db;
  }
  function save() { store.set(STORE_KEY, JSON.stringify(db)); }
  function resetMock() { db = window.BJA_MOCK.build(); save(); }

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const r2 = (x) => Math.round(x * 100) / 100;
  const fail = (status, code, message, fields) => { throw new ApiError(status, code, message, fields); };
  const invalid = (fields) => fail(422, 'VALIDATION_ERROR', 'Проверьте заполнение полей', fields);
  const fmtKm = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  function currentUser(req) {
    const uid = db.tokens[req.token];
    const u = db.users.find((x) => x.id === uid);
    if (!u) fail(401, 'UNAUTHORIZED', 'Сеанс завершён, войдите снова');
    return u;
  }
  function publicUser(u) { return { id: u.id, email: u.email, name: u.name, registered_at: u.registered_at }; }
  function issueToken(u) {
    const t = 'mock.' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    db.tokens[t] = u.id; save();
    return { token: t, expires_at: new Date(Date.now() + 86400000).toISOString().replace(/\.\d+Z$/, 'Z'), user: publicUser(u) };
  }

  function recordsOf(carId) {
    return db.repairs.filter((r) => r.car_id === carId).map((r) => ({ ...r, type: 'repair' }))
      .concat(db.refuels.filter((r) => r.car_id === carId).map((r) => ({ ...r, type: 'refuel' })));
  }
  function carView(c) {
    const recs = recordsOf(c.id).sort(byDateDesc);
    const last = recs[0];
    return {
      id: c.id, brand: c.brand, model: c.model, year: c.year, plate_number: c.plate_number, vin: c.vin,
      initial_mileage: c.initial_mileage,
      current_mileage: last ? Math.max(...recs.map((r) => r.mileage)) : c.initial_mileage,
      last_record_date: last ? last.date : null,
      repairs_count: recs.filter((r) => r.type === 'repair').length,
      refuels_count: recs.filter((r) => r.type === 'refuel').length,
      created_at: c.created_at
    };
  }
  function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.mileage - a.mileage; }
  function byDateAsc(a, b) { return -byDateDesc(a, b); }
  function ownCar(user, id) {
    const c = db.cars.find((x) => x.id === Number(id) && x.user_id === user.id);
    if (!c) fail(404, 'NOT_FOUND', 'Автомобиль не найден');
    return c;
  }
  const cat = (id) => db.repair_categories.find((c) => c.id === id);
  const ft = (id) => db.fuel_types.find((c) => c.id === id);
  function repairView(r) {
    return { id: r.id, car_id: r.car_id, date: r.date, mileage: r.mileage, category: cat(r.category_id), description: r.description,
      place: r.place || '', labor_cost: r2(r.labor_cost), parts_cost: r2(r.parts_cost), total_cost: r2(r.labor_cost + r.parts_cost) };
  }
  function refuelView(r) {
    return { id: r.id, car_id: r.car_id, date: r.date, mileage: r.mileage, station: r.station || '', fuel_type: ft(r.fuel_type_id),
      volume: r2(r.volume), price_per_liter: r2(r.price_per_liter), amount: r2(r.amount), full_tank: !!r.full_tank };
  }

  /* Контроль пробега, п. 4.3.1 ТЗ */
  function mileageRange(car, date, exType, exId) {
    const recs = recordsOf(car.id).filter((r) => !(r.type === exType && r.id === exId));
    let min = car.initial_mileage, max = null;
    recs.forEach((r) => {
      if (r.date < date) min = Math.max(min, r.mileage);
      if (r.date > date) max = max === null ? r.mileage : Math.min(max, r.mileage);
    });
    return { date, min, max };
  }
  function checkMileage(car, date, mileage, exType, exId) {
    const rg = mileageRange(car, date, exType, exId);
    if (mileage < rg.min || (rg.max !== null && mileage > rg.max)) {
      const msg = rg.max === null
        ? `Пробег не может быть меньше ${fmtKm(rg.min)} км — это пробег предыдущей записи`
        : `Пробег должен быть от ${fmtKm(rg.min)} до ${fmtKm(rg.max)} км — между соседними записями`;
      fail(422, 'MILEAGE_CONFLICT', 'Пробег противоречит другим записям', { mileage: msg });
    }
  }

  const isInt = (v) => Number.isInteger(v);
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));

  function validateCar(b) {
    const f = {}, y = new Date().getFullYear();
    if (!b.brand || !String(b.brand).trim()) f.brand = 'Укажите марку';
    if (!b.model || !String(b.model).trim()) f.model = 'Укажите модель';
    if (!isInt(b.year) || b.year < 1900 || b.year > y) f.year = `Год выпуска — от 1900 до ${y}`;
    if (!b.plate_number || !String(b.plate_number).trim()) f.plate_number = 'Укажите гос. номер';
    if (b.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(b.vin)) f.vin = 'VIN — 17 символов: латинские буквы, кроме I, O, Q, и цифры';
    if (!isInt(b.initial_mileage) || b.initial_mileage < 0) f.initial_mileage = 'Укажите пробег целым числом от 0';
    if (Object.keys(f).length) invalid(f);
  }
  function validateRecordBase(b, f) {
    if (!isDate(b.date)) f.date = 'Укажите дату';
    else if (b.date > today()) f.date = 'Дата не может быть позже сегодняшней';
    if (!isInt(b.mileage) || b.mileage < 0) f.mileage = 'Укажите пробег целым числом, км';
  }
  function validateRepair(b) {
    const f = {}; validateRecordBase(b, f);
    if (!cat(b.category_id)) f.category_id = 'Выберите категорию работ';
    if (!b.description || !String(b.description).trim()) f.description = 'Опишите, что сделано';
    if (!isNum(b.labor_cost) || b.labor_cost < 0) f.labor_cost = 'Стоимость работ — число от 0';
    if (!isNum(b.parts_cost) || b.parts_cost < 0) f.parts_cost = 'Стоимость запчастей — число от 0';
    if (Object.keys(f).length) invalid(f);
  }
  function validateRefuel(b) {
    const f = {}; validateRecordBase(b, f);
    if (!ft(b.fuel_type_id)) f.fuel_type_id = 'Выберите вид топлива';
    if (!isNum(b.volume) || b.volume <= 0 || b.volume > 500) f.volume = 'Укажите объём больше 0';
    if (!isNum(b.price_per_liter) || b.price_per_liter <= 0) f.price_per_liter = 'Укажите цену больше 0';
    if (Object.keys(f).length) invalid(f);
  }

  function inPeriod(r, q) {
    return (!q.date_from || r.date >= q.date_from) && (!q.date_to || r.date <= q.date_to);
  }
  function page(items, q) {
    const off = Number(q.offset || 0), lim = Math.min(Number(q.limit || 50), 200);
    return items.slice(off, off + lim);
  }

  function summary(car, q) {
    const reps = db.repairs.filter((r) => r.car_id === car.id && inPeriod(r, q));
    const refs = db.refuels.filter((r) => r.car_id === car.id && inPeriod(r, q)).sort((a, b) => a.mileage - b.mileage || (a.date < b.date ? -1 : 1));
    const repairs_total = r2(reps.reduce((s, r) => s + r.labor_cost + r.parts_cost, 0));
    const fuel_total = r2(refs.reduce((s, r) => s + r.amount, 0));
    const all = reps.concat(refs);
    const kms = all.map((r) => r.mileage);
    const distance = kms.length ? Math.max(...kms) - Math.min(...kms) : 0;
    let avg = null;
    const fullIdx = refs.map((r, i) => (r.full_tank ? i : -1)).filter((i) => i >= 0);
    if (fullIdx.length >= 2) {
      const a = fullIdx[0], b = fullIdx[fullIdx.length - 1];
      const vol = refs.slice(a + 1, b + 1).reduce((s, r) => s + r.volume, 0);
      const dl = refs[b].mileage - refs[a].mileage;
      if (dl > 0) avg = r2(vol / dl * 100);
    }
    const byCat = {};
    reps.forEach((r) => { const c = byCat[r.category_id] || (byCat[r.category_id] = { category: cat(r.category_id), total: 0, count: 0 }); c.total += r.labor_cost + r.parts_cost; c.count++; });
    const months = [];
    const dates = all.map((r) => r.date).sort();
    const from = (q.date_from || dates[0] || today()).slice(0, 7);
    const to = (q.date_to || today()).slice(0, 7);
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      months.push({ month: key,
        repairs: r2(reps.filter((r) => r.date.startsWith(key)).reduce((s, r) => s + r.labor_cost + r.parts_cost, 0)),
        fuel: r2(refs.filter((r) => r.date.startsWith(key)).reduce((s, r) => s + r.amount, 0)) });
      m++; if (m > 12) { m = 1; y++; }
    }
    const total = r2(repairs_total + fuel_total);
    return {
      car_id: car.id, date_from: q.date_from || null, date_to: q.date_to || null,
      repairs_total, fuel_total, total,
      fuel_volume: r2(refs.reduce((s, r) => s + r.volume, 0)),
      distance, avg_consumption: avg, cost_per_km: distance ? r2(total / distance) : null,
      by_category: Object.values(byCat).map((c) => ({ ...c, total: r2(c.total) })).sort((a, b) => b.total - a.total),
      by_month: months
    };
  }

  /* Таблица маршрутов макета сервера — совпадает со сводной таблицей в docs/API.md */
  const routes = [
    ['POST', /^\/auth\/register$/, (req) => {
      const b = req.body || {}, f = {};
      if (!b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) f.email = 'Укажите e-mail в формате name@example.ru';
      if (!b.password || String(b.password).length < 8) f.password = 'Пароль — не менее 8 символов';
      if (!b.name || !String(b.name).trim()) f.name = 'Укажите имя';
      if (Object.keys(f).length) invalid(f);
      if (db.users.some((u) => u.email.toLowerCase() === b.email.toLowerCase())) fail(409, 'EMAIL_TAKEN', 'Пользователь с таким e-mail уже зарегистрирован', { email: 'Этот e-mail уже зарегистрирован. Войдите или укажите другой' });
      const u = { id: ++db.seq.users, email: b.email.trim(), password: b.password, name: b.name.trim(), registered_at: new Date().toISOString() };
      db.users.push(u);
      return [201, issueToken(u)];
    }],
    ['POST', /^\/auth\/login$/, (req) => {
      const b = req.body || {};
      const u = db.users.find((x) => x.email.toLowerCase() === String(b.email || '').toLowerCase().trim() && x.password === b.password);
      if (!u) fail(401, 'INVALID_CREDENTIALS', 'Неверный e-mail или пароль');
      return [200, issueToken(u)];
    }],
    ['POST', /^\/auth\/logout$/, (req) => { currentUser(req); delete db.tokens[req.token]; save(); return [204, null]; }],
    ['GET', /^\/auth\/me$/, (req) => [200, publicUser(currentUser(req))]],
    ['GET', /^\/repair-categories$/, (req) => { currentUser(req); return [200, db.repair_categories]; }],
    ['GET', /^\/fuel-types$/, (req) => { currentUser(req); return [200, db.fuel_types]; }],
    ['GET', /^\/cars$/, (req) => { const u = currentUser(req); return [200, db.cars.filter((c) => c.user_id === u.id).map(carView)]; }],
    ['POST', /^\/cars$/, (req) => {
      const u = currentUser(req), b = req.body || {};
      validateCar(b);
      if (db.cars.filter((c) => c.user_id === u.id).length >= 10) invalid({ limit: 'Можно добавить не больше 10 автомобилей' });
      const c = { id: ++db.seq.cars, user_id: u.id, brand: b.brand.trim(), model: b.model.trim(), year: b.year,
        plate_number: String(b.plate_number).replace(/\s+/g, '').toUpperCase(), vin: b.vin ? b.vin.toUpperCase() : null,
        initial_mileage: b.initial_mileage, created_at: new Date().toISOString() };
      db.cars.push(c);
      return [201, carView(c)];
    }],
    ['GET', /^\/cars\/(\d+)$/, (req, m) => [200, carView(ownCar(currentUser(req), m[1]))]],
    ['PUT', /^\/cars\/(\d+)$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]), b = req.body || {};
      validateCar(b);
      const recs = recordsOf(c.id);
      const minRec = recs.length ? Math.min(...recs.map((r) => r.mileage)) : Infinity;
      if (b.initial_mileage > minRec) fail(422, 'MILEAGE_CONFLICT', 'Начальный пробег больше пробега в записях', { initial_mileage: `Начальный пробег не может быть больше ${fmtKm(minRec)} км — пробега самой ранней записи` });
      Object.assign(c, { brand: b.brand.trim(), model: b.model.trim(), year: b.year, plate_number: String(b.plate_number).replace(/\s+/g, '').toUpperCase(), vin: b.vin ? b.vin.toUpperCase() : null, initial_mileage: b.initial_mileage });
      return [200, carView(c)];
    }],
    ['DELETE', /^\/cars\/(\d+)$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]);
      db.cars = db.cars.filter((x) => x.id !== c.id);
      db.repairs = db.repairs.filter((x) => x.car_id !== c.id);
      db.refuels = db.refuels.filter((x) => x.car_id !== c.id);
      return [204, null];
    }],
    ['GET', /^\/cars\/(\d+)\/records$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]);
      const items = recordsOf(c.id).sort(byDateDesc).slice(0, Number(req.query.limit || 5)).map((r) => r.type === 'repair'
        ? { type: 'repair', id: r.id, date: r.date, mileage: r.mileage, title: r.description, category: cat(r.category_id).name, amount: r2(r.labor_cost + r.parts_cost) }
        : { type: 'refuel', id: r.id, date: r.date, mileage: r.mileage, title: `${r.station.split(',')[0]}, ${ft(r.fuel_type_id).name}, ${r.volume.toFixed(2).replace('.', ',')} л`, category: r.full_tank ? 'полный бак' : 'долив', amount: r2(r.amount) });
      return [200, { items }];
    }],
    ['GET', /^\/cars\/(\d+)\/mileage-range$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]);
      if (!isDate(req.query.date)) invalid({ date: 'Укажите дату' });
      return [200, mileageRange(c, req.query.date, req.query.exclude_type, Number(req.query.exclude_id))];
    }],
    ['GET', /^\/cars\/(\d+)\/repairs$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]), q = req.query;
      const text = (q.q || '').trim().toLowerCase();
      let items = db.repairs.filter((r) => r.car_id === c.id && inPeriod(r, q)
        && (!text || (r.description + ' ' + (r.place || '')).toLowerCase().includes(text))
        && (!q.category_id || r.category_id === Number(q.category_id))
        && (!q.mileage_from || r.mileage >= Number(q.mileage_from))
        && (!q.mileage_to || r.mileage <= Number(q.mileage_to)));
      items.sort(q.sort === 'date_asc' ? byDateAsc : q.sort === 'cost_desc' ? (a, b) => (b.labor_cost + b.parts_cost) - (a.labor_cost + a.parts_cost) : byDateDesc);
      const sum = { labor_cost: r2(items.reduce((s, r) => s + r.labor_cost, 0)), parts_cost: r2(items.reduce((s, r) => s + r.parts_cost, 0)) };
      sum.total_cost = r2(sum.labor_cost + sum.parts_cost);
      return [200, { items: page(items, q).map(repairView), total_count: items.length, sum }];
    }],
    ['POST', /^\/cars\/(\d+)\/repairs$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]), b = req.body || {};
      validateRepair(b); checkMileage(c, b.date, b.mileage);
      const r = { id: ++db.seq.repairs, car_id: c.id, date: b.date, mileage: b.mileage, category_id: b.category_id, description: b.description.trim(), place: (b.place || '').trim(), labor_cost: r2(b.labor_cost), parts_cost: r2(b.parts_cost) };
      db.repairs.push(r);
      return [201, repairView(r)];
    }],
    ['GET', /^\/cars\/(\d+)\/repairs\/(\d+)$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]);
      const r = db.repairs.find((x) => x.id === Number(m[2]) && x.car_id === c.id) || fail(404, 'NOT_FOUND', 'Запись не найдена');
      return [200, repairView(r)];
    }],
    ['PUT', /^\/cars\/(\d+)\/repairs\/(\d+)$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]), b = req.body || {};
      const r = db.repairs.find((x) => x.id === Number(m[2]) && x.car_id === c.id) || fail(404, 'NOT_FOUND', 'Запись не найдена');
      validateRepair(b); checkMileage(c, b.date, b.mileage, 'repair', r.id);
      Object.assign(r, { date: b.date, mileage: b.mileage, category_id: b.category_id, description: b.description.trim(), place: (b.place || '').trim(), labor_cost: r2(b.labor_cost), parts_cost: r2(b.parts_cost) });
      return [200, repairView(r)];
    }],
    ['DELETE', /^\/cars\/(\d+)\/repairs\/(\d+)$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]);
      if (!db.repairs.some((x) => x.id === Number(m[2]) && x.car_id === c.id)) fail(404, 'NOT_FOUND', 'Запись не найдена');
      db.repairs = db.repairs.filter((x) => x.id !== Number(m[2]));
      return [204, null];
    }],
    ['GET', /^\/cars\/(\d+)\/refuels$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]), q = req.query;
      const items = db.refuels.filter((r) => r.car_id === c.id && inPeriod(r, q) && (!q.fuel_type_id || r.fuel_type_id === Number(q.fuel_type_id)));
      items.sort(q.sort === 'date_asc' ? byDateAsc : byDateDesc);
      return [200, { items: page(items, q).map(refuelView), total_count: items.length,
        sum: { volume: r2(items.reduce((s, r) => s + r.volume, 0)), amount: r2(items.reduce((s, r) => s + r.amount, 0)) } }];
    }],
    ['POST', /^\/cars\/(\d+)\/refuels$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]), b = req.body || {};
      validateRefuel(b); checkMileage(c, b.date, b.mileage);
      const r = { id: ++db.seq.refuels, car_id: c.id, date: b.date, mileage: b.mileage, station: (b.station || '').trim(), fuel_type_id: b.fuel_type_id,
        volume: r2(b.volume), price_per_liter: r2(b.price_per_liter), amount: r2(b.volume * b.price_per_liter), full_tank: !!b.full_tank };
      db.refuels.push(r);
      return [201, refuelView(r)];
    }],
    ['GET', /^\/cars\/(\d+)\/refuels\/(\d+)$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]);
      const r = db.refuels.find((x) => x.id === Number(m[2]) && x.car_id === c.id) || fail(404, 'NOT_FOUND', 'Запись не найдена');
      return [200, refuelView(r)];
    }],
    ['PUT', /^\/cars\/(\d+)\/refuels\/(\d+)$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]), b = req.body || {};
      const r = db.refuels.find((x) => x.id === Number(m[2]) && x.car_id === c.id) || fail(404, 'NOT_FOUND', 'Запись не найдена');
      validateRefuel(b); checkMileage(c, b.date, b.mileage, 'refuel', r.id);
      Object.assign(r, { date: b.date, mileage: b.mileage, station: (b.station || '').trim(), fuel_type_id: b.fuel_type_id, volume: r2(b.volume), price_per_liter: r2(b.price_per_liter), amount: r2(b.volume * b.price_per_liter), full_tank: !!b.full_tank });
      return [200, refuelView(r)];
    }],
    ['DELETE', /^\/cars\/(\d+)\/refuels\/(\d+)$/, (req, m) => {
      const c = ownCar(currentUser(req), m[1]);
      if (!db.refuels.some((x) => x.id === Number(m[2]) && x.car_id === c.id)) fail(404, 'NOT_FOUND', 'Запись не найдена');
      db.refuels = db.refuels.filter((x) => x.id !== Number(m[2]));
      return [204, null];
    }],
    ['GET', /^\/cars\/(\d+)\/summary$/, (req, m) => [200, summary(ownCar(currentUser(req), m[1]), req.query)]],
    ['GET', /^\/health$/, () => [200, { status: 'ok', db: 'ok', time: new Date().toISOString() }]]
  ];

  /* Демо-данные подгружаются только в режиме макета, в рабочую сборку не попадают */
  let mockScript = null;
  function loadMockData() {
    if (window.BJA_MOCK) return Promise.resolve();
    if (!mockScript) mockScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/mock-data.js'; s.onload = resolve;
      s.onerror = () => reject(new ApiError(500, 'INTERNAL_ERROR', 'Не удалось загрузить демо-данные'));
      document.head.appendChild(s);
    });
    return mockScript;
  }

  async function mockRequest(method, path, body) {
    await loadMockData();
    load();
    const [p, qs] = path.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const tok = token.get();
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          for (const [m, re, fn] of routes) {
            const match = m === method && p.match(re);
            if (match) {
              const [, data] = fn({ body: body ? JSON.parse(JSON.stringify(body)) : null, query, token: tok }, match);
              save();
              return resolve(data);
            }
          }
          fail(404, 'NOT_FOUND', 'Метод не найден');
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError(500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера');
          if (err.status === 401 && !/^\/auth\/(login|register)$/.test(p)) emit('bja:unauthorized');
          reject(err);
        }
      }, CONFIG.MOCK_DELAY_MS);
    });
  }

  function request(method, path, body) {
    return CONFIG.USE_MOCK ? mockRequest(method, path, body) : httpRequest(method, path, body);
  }
  const enc = encodeURIComponent;
  const qs = (o) => {
    const e = Object.entries(o || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined);
    return e.length ? '?' + new URLSearchParams(e).toString() : '';
  };

  /* Журналы отдают не больше 200 записей за запрос (п. 1.3 docs/API.md). Если экрану нужно больше
     («Показать ещё»), догружаем страницами через offset; total_count и sum берём из первого ответа */
  const PAGE_MAX = 200;
  async function paged(path, q) {
    const want = Number((q && q.limit) || 50);
    if (want <= PAGE_MAX) return request('GET', path + qs(q));
    const first = await request('GET', path + qs({ ...q, limit: PAGE_MAX, offset: 0 }));
    const items = first.items.slice();
    while (items.length < Math.min(want, first.total_count)) {
      const next = await request('GET', path + qs({ ...q, limit: Math.min(PAGE_MAX, want - items.length), offset: items.length }));
      if (!next.items.length) break;
      items.push(...next.items);
    }
    return { ...first, items };
  }

  /* Методы API — нумерация как в docs/API.md */
  window.API = {
    CONFIG, ApiError, token, resetMock,
    request, mockRequest,
    register: (b) => request('POST', '/auth/register', b),                                  // 1
    login: (b) => request('POST', '/auth/login', b),                                        // 2
    logout: () => request('POST', '/auth/logout'),                                          // 3
    me: () => request('GET', '/auth/me'),                                                   // 4
    repairCategories: () => request('GET', '/repair-categories'),                           // 5
    fuelTypes: () => request('GET', '/fuel-types'),                                         // 6
    cars: () => request('GET', '/cars'),                                                    // 7
    createCar: (b) => request('POST', '/cars', b),                                          // 8
    car: (id) => request('GET', `/cars/${enc(id)}`),                                             // 9
    updateCar: (id, b) => request('PUT', `/cars/${enc(id)}`, b),                                 // 10
    deleteCar: (id) => request('DELETE', `/cars/${enc(id)}`),                                    // 11
    records: (id, q) => request('GET', `/cars/${enc(id)}/records${qs(q)}`),                      // 12
    mileageRange: (id, q) => request('GET', `/cars/${enc(id)}/mileage-range${qs(q)}`),           // 13
    repairs: (id, q) => paged(`/cars/${enc(id)}/repairs`, q),                                    // 14
    createRepair: (id, b) => request('POST', `/cars/${enc(id)}/repairs`, b),                     // 15
    repair: (id, rid) => request('GET', `/cars/${enc(id)}/repairs/${enc(rid)}`),                      // 16
    updateRepair: (id, rid, b) => request('PUT', `/cars/${enc(id)}/repairs/${enc(rid)}`, b),          // 17
    deleteRepair: (id, rid) => request('DELETE', `/cars/${enc(id)}/repairs/${enc(rid)}`),             // 18
    refuels: (id, q) => paged(`/cars/${enc(id)}/refuels`, q),                                    // 19
    createRefuel: (id, b) => request('POST', `/cars/${enc(id)}/refuels`, b),                     // 20
    refuel: (id, rid) => request('GET', `/cars/${enc(id)}/refuels/${enc(rid)}`),                      // 21
    updateRefuel: (id, rid, b) => request('PUT', `/cars/${enc(id)}/refuels/${enc(rid)}`, b),          // 22
    deleteRefuel: (id, rid) => request('DELETE', `/cars/${enc(id)}/refuels/${enc(rid)}`),             // 23
    summary: (id, q) => request('GET', `/cars/${enc(id)}/summary${qs(q)}`),                      // 24
    health: () => request('GET', '/health')                                                 // 25
  };
})();
