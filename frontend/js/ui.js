/* Общие элементы интерфейса: иконки, форматирование, номерной знак, одометр, окна, уведомления */
(function () {
  'use strict';

  const ICONS = {
    car: '<path d="M5 16h14M6.5 16v2.5M17.5 16v2.5M4 16v-4l2-5.2A2 2 0 0 1 7.9 5.5h8.2A2 2 0 0 1 18 6.8L20 12v4"/><path d="M4 12h16"/><circle cx="7.5" cy="14" r=".6"/><circle cx="16.5" cy="14" r=".6"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5l-5.6 5.6a1.5 1.5 0 0 0 2.1 2.1l5.6-5.6a4 4 0 0 0 5-5.4l-2.5 2.5-2.1-.6-.6-2.1z"/>',
    fuel: '<path d="M4 20V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 14 5v15M3 20h12M6.5 8h5"/><path d="M14 10h1.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8.5L17.5 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    chart: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>',
    gauge: '<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="m12 13 3.5-4"/><circle cx="12" cy="13" r="1"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 2-2.2 3.4M12 16.8v.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.2v.3"/>',
    garage: '<path d="M3 20V9l9-5 9 5v11"/><path d="M7 20v-7h10v7M7 16h10"/>',
    logout: '<path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10M15 16l4-4-4-4M19 12H9"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    road: '<path d="M8 3 4 21M16 3l4 18M12 4v2.5M12 10v3M12 17v3"/>'
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NB = ' ';
  const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
  const money = (n, frac) => {
    const v = Number(n || 0);
    const showFrac = frac === undefined ? Math.round(v * 100) % 100 !== 0 : frac;
    const [i, f] = Math.abs(v).toFixed(2).split('.');
    return (v < 0 ? '−' : '') + group(i) + (showFrac ? ',' + f : '') + NB + '₽';
  };
  const km = (n) => group(n) + NB + 'км';
  const liters = (n) => Number(n).toFixed(2).replace('.', ',') + NB + 'л';
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const date = (s) => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
  const dateLong = (s) => { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };

  /* Российский номерной знак: А123ВС77 → «А 123 ВС | 77 RUS» */
  function plate(num, large) {
    const s = String(num || '').toUpperCase();
    const m = s.match(/^([А-ЯA-Z])(\d{3})([А-ЯA-Z]{2})(\d{2,3})$/);
    const cls = 'plate' + (large ? ' plate-lg' : '');
    if (!m) return `<span class="${cls}" aria-label="Гос. номер ${esc(s)}"><span class="plate-main">${esc(s)}</span></span>`;
    return `<span class="${cls}" aria-label="Гос. номер ${esc(s)}"><span class="plate-main"><span>${m[1]}</span><span class="d">${m[2]}</span><span>${m[3]}</span></span><span class="plate-region">${m[4]}<i>RUS</i></span></span>`;
  }

  /* Одометр из барабанов: значение «прокручивается» при первом показе */
  function odometer(value) {
    const digits = String(value).padStart(6, '0').split('');
    const lead = String(value).length;
    const cells = digits.map((d, i) => {
      const strip = Array.from({ length: 10 }, (_, k) => `<span>${k}</span>`).join('');
      return `<span class="odo-cell${i < digits.length - lead ? ' lead' : ''}"><span class="odo-strip" data-digit="${d}">${strip}</span></span>`;
    }).join('');
    return `<div class="odometer" role="img" aria-label="Пробег ${group(value)} километров"><span class="odo-drums">${cells}</span><span class="odo-unit">км</span></div>`;
  }
  function spinOdometers(root) {
    const strips = root.querySelectorAll('.odo-strip');
    const h = () => (strips[0] ? strips[0].firstElementChild.getBoundingClientRect().height : 56);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const set = () => strips.forEach((s) => { s.style.transform = `translateY(-${Number(s.dataset.digit) * h()}px)`; });
    if (reduce || window.BJA_STATIC) { strips.forEach((s) => { s.style.transition = 'none'; }); set(); return; }
    requestAnimationFrame(() => requestAnimationFrame(set));
  }

  /* Модальное окно. Возвращает { el, close } */
  function modal({ title, body, foot, size, onClose }) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal ${size === 'sm' ? 'modal-sm' : ''}" role="dialog" aria-modal="true" aria-labelledby="mdl-title">
      <div class="modal-head"><h2 id="mdl-title">${title}</h2><button class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${foot}</div></div>`;
    const prev = document.activeElement;
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); onClose && onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    const first = ov.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-foot .btn-danger');
    if (first) setTimeout(() => first.focus(), 0);
    return { el: ov, close };
  }

  function confirmDialog({ title, text, action }) {
    return new Promise((resolve) => {
      let done = false;
      const m = modal({
        title, size: 'sm',
        body: `<p>${text}</p>`,
        foot: `<button class="btn" data-close>Отмена</button><button class="btn btn-danger" data-ok>${icon('trash')}${action}</button>`,
        onClose: () => { if (!done) resolve(false); }
      });
      m.el.querySelector('[data-ok]').addEventListener('click', () => { done = true; m.close(); resolve(true); });
    });
  }

  let toastTimer;
  function toast(text) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status');
    t.innerHTML = icon('check') + esc(text);
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3200);
  }

  /* Ошибки сервера → подсветка полей формы */
  function showErrors(form, err) {
    clearErrors(form);
    const fields = (err && err.fields) || {};
    let firstBad = null;
    Object.entries(fields).forEach(([name, msg]) => {
      const f = form.querySelector(`.field[data-name="${name}"]`);
      if (f) { f.classList.add('invalid'); f.querySelector('.error').textContent = msg; firstBad = firstBad || f.querySelector('input,select,textarea'); }
    });
    const box = form.querySelector('.form-alert');
    if (box) {
      const unmapped = Object.keys(fields).filter((n) => !form.querySelector(`.field[data-name="${n}"]`));
      const text = !Object.keys(fields).length || unmapped.length ? (unmapped.length ? fields[unmapped[0]] : err.message) : '';
      box.innerHTML = text ? `<div class="alert" role="alert">${icon('alert')}<span>${esc(text)}</span></div>` : '';
    }
    if (firstBad) firstBad.focus();
  }
  function clearErrors(form) {
    form.querySelectorAll('.field.invalid').forEach((f) => f.classList.remove('invalid'));
    const box = form.querySelector('.form-alert'); if (box) box.innerHTML = '';
  }

  /* Поле формы */
  function field({ name, label, type = 'text', value = '', req, hint, suffix, attrs = '', options, rows, cls = '', prefix = 'f-' }) {
    const id = prefix + name;
    const v = esc(value);
    let control;
    if (options) control = `<select class="input" id="${id}" name="${name}" ${attrs}>${options}</select>`;
    else if (type === 'textarea') control = `<textarea class="input" id="${id}" name="${name}" rows="${rows || 3}" ${attrs}>${v}</textarea>`;
    else control = `<input class="input" id="${id}" name="${name}" type="${type}" value="${v}" ${attrs}>`;
    if (suffix) control = `<div class="input-suffix">${control}<span>${suffix}</span></div>`;
    return `<div class="field ${cls}" data-name="${name}"><label for="${id}">${label}${req ? '<span class="req" aria-hidden="true">*</span><span class="visually-hidden"> (обязательно)</span>' : ''}</label>${control}<span class="hint" id="${id}-hint">${hint || ''}</span><span class="error" id="${id}-err" aria-live="polite"></span></div>`;
  }

  window.UI = { icon, esc, money, km, liters, date, dateLong, today, plural, group, plate, odometer, spinOdometers, modal, confirmDialog, toast, showErrors, clearErrors, field, MONTHS, MONTHS_SHORT };
})();
