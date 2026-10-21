/* Демонстрационные данные прототипа.
   Генерируются детерминированно, поэтому скриншоты макетов всегда одинаковые. */
(function () {
  'use strict';

  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DAY = 86400000;
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  const r2 = (x) => Math.round(x * 100) / 100;

  const REPAIR_CATEGORIES = [
    { id: 1, name: 'ТО' }, { id: 2, name: 'Двигатель' }, { id: 3, name: 'Ходовая часть' },
    { id: 4, name: 'Тормозная система' }, { id: 5, name: 'Электрика' }, { id: 6, name: 'Кузов' },
    { id: 7, name: 'Шины' }, { id: 8, name: 'Прочее' }
  ];
  const FUEL_TYPES = [
    { id: 1, name: 'АИ-92' }, { id: 2, name: 'АИ-95' }, { id: 3, name: 'АИ-98' },
    { id: 4, name: 'ДТ' }, { id: 5, name: 'Газ' }
  ];
  const STATIONS = [
    'Лукойл, Каширское ш., 61', 'Роснефть, Варшавское ш., 132', 'Газпромнефть, ул. Кировоградская, 2',
    'Лукойл, МКАД 33-й км', 'Татнефть, Балаклавский пр-т, 7'
  ];

  /* Моделирование эксплуатации: пробег по дням и заправки по уровню топлива */
  function simulate(opt) {
    const rand = rng(opt.seed);
    const start = Date.parse(opt.start), end = Date.parse(opt.end);
    const mileageByDay = {};
    const refuels = [];
    let km = opt.initial, fuel = opt.tank * 0.6, i = 0, st = 0;
    for (let t = start; t <= end; t += DAY, i++) {
      const d = new Date(t);
      const winter = [11, 0, 1].includes(d.getUTCMonth());
      let daily = opt.daily + opt.daily * 0.38 * Math.sin(i / 7) + (rand() - 0.5) * opt.daily * 0.4;
      if (d.getUTCDay() === 0 && rand() < 0.5) daily *= 0.3;
      daily = Math.max(0, Math.round(daily));
      km += daily;
      const cons = opt.cons + (winter ? 0.7 : 0) + (rand() - 0.5) * 0.4;
      fuel -= daily * cons / 100;
      if (fuel < opt.tank * 0.2) {
        const full = rand() < 0.84;
        const vol = full ? r2(opt.tank - fuel - rand() * 0.6) : r2(18 + rand() * 12);
        const months = (t - start) / (30.4 * DAY);
        const price = r2(opt.price + months * opt.priceGrow + (rand() - 0.5) * 0.9);
        refuels.push({
          date: iso(t), mileage: km, station: STATIONS[(st++ + (rand() < 0.3 ? 2 : 0)) % STATIONS.length],
          fuel_type_id: opt.fuel, volume: vol, price_per_liter: price, amount: r2(vol * price), full_tank: full
        });
        fuel = full ? opt.tank : fuel + vol;
      }
      mileageByDay[iso(t)] = km;
    }
    return { mileageByDay, refuels };
  }

  function build() {
    const db = {
      repair_categories: REPAIR_CATEGORIES,
      fuel_types: FUEL_TYPES,
      users: [{ id: 1, email: 'ivan.petrov@mail.ru', password: 'qwerty123', name: 'Иван Петров', registered_at: '2025-01-12T09:10:00Z' }],
      cars: [
        { id: 1, user_id: 1, brand: 'Lada', model: 'Vesta', year: 2019, plate_number: 'А123ВС77', vin: 'XTAGFL110KY123456', initial_mileage: 45000, created_at: '2025-01-12T09:15:00Z' },
        { id: 2, user_id: 1, brand: 'Hyundai', model: 'Solaris', year: 2017, plate_number: 'Е777КХ199', vin: null, initial_mileage: 98000, created_at: '2026-06-01T18:40:00Z' }
      ],
      repairs: [],
      refuels: [],
      tokens: {},
      seq: { users: 1, cars: 2, repairs: 0, refuels: 0 }
    };

    const vesta = simulate({ seed: 7, start: '2025-01-12', end: '2026-10-18', initial: 45000, daily: 50, cons: 7.6, tank: 55, fuel: 2, price: 55.4, priceGrow: 0.36 });
    const solaris = simulate({ seed: 19, start: '2026-06-01', end: '2026-10-16', initial: 98000, daily: 31, cons: 7.1, tank: 43, fuel: 1, price: 57.6, priceGrow: 0.3 });

    const R = (car, sim, date, cat, description, place, labor, parts) => ({
      car_id: car, date, mileage: sim.mileageByDay[date], category_id: cat, description, place, labor_cost: labor, parts_cost: parts
    });
    const MOTOR = 'СТО «Мотор», Варшавское ш., 118';
    const KOLESO = 'Шиномонтаж «Колесо», ул. Кировоградская, 9';
    const repairs = [
      R(1, vesta, '2025-01-25', 1, 'ТО-4: замена масла, масляного и воздушного фильтров', MOTOR, 2200, 4850),
      R(1, vesta, '2025-04-12', 7, 'Сезонная замена шин на летние, балансировка', KOLESO, 2400, 0),
      R(1, vesta, '2025-06-21', 3, 'Замена передних стоек стабилизатора', MOTOR, 1500, 2380),
      R(1, vesta, '2025-08-30', 1, 'ТО-5: замена масла, фильтров и свечей зажигания', MOTOR, 3100, 6900),
      R(1, vesta, '2025-10-25', 7, 'Сезонная замена шин на зимние, балансировка', KOLESO, 2400, 0),
      R(1, vesta, '2025-12-13', 5, 'Замена аккумулятора 60 А·ч', 'Автомагазин на Чертановской, 32', 0, 7900),
      R(1, vesta, '2026-03-07', 6, 'Покраска переднего бампера после парковки', 'Кузовной центр «Профи»', 9500, 1800),
      R(1, vesta, '2026-04-11', 7, 'Сезонная замена шин на летние, балансировка', KOLESO, 2600, 0),
      R(1, vesta, '2026-04-19', 4, 'Замена передних тормозных колодок и дисков', MOTOR, 1800, 6400),
      R(1, vesta, '2026-07-04', 8, 'Замена щёток стеклоочистителя и лампы ближнего света', 'Своими силами', 0, 1450),
      R(1, vesta, '2026-08-22', 1, 'ТО-6: замена масла, фильтров и тормозной жидкости', MOTOR, 3600, 7250),
      R(1, vesta, '2026-10-03', 2, 'Замена ремня ГРМ, роликов и помпы', MOTOR, 4800, 7600),
      R(1, vesta, '2026-10-17', 7, 'Сезонная замена шин на зимние, балансировка', KOLESO, 2600, 0),
      R(2, solaris, '2026-07-15', 1, 'ТО: замена масла и фильтров', 'Дилерский центр Hyundai, Каширское ш., 41', 2000, 4300),
      R(2, solaris, '2026-09-20', 3, 'Развал-схождение', KOLESO, 2200, 0)
    ];
    repairs.forEach((r) => { r.id = ++db.seq.repairs; db.repairs.push(r); });
    vesta.refuels.forEach((f) => { f.car_id = 1; f.id = ++db.seq.refuels; db.refuels.push(f); });
    solaris.refuels.forEach((f) => { f.car_id = 2; f.id = ++db.seq.refuels; db.refuels.push(f); });
    return db;
  }

  window.BJA_MOCK = { build };
})();
