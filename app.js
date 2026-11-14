(function () {
  "use strict";

  const DATA = window.QUIZ_DATA;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const W = DATA.width, H = DATA.height;
  const MAX_ZOOM = 150;
  const SMALL_CAPITAL_MIN_PX = 24; // с какого размера страны-кружка на экране показывать её столицу
  const SMALL_CAPITAL_ALWAYS_ZOOM = 40; // при таком приближении столицы стран-кружков видны всегда
  const DOT_RADIUS = 4.5;
  const DRAG_THRESHOLD = 6;

  const byCode = Object.fromEntries(DATA.countries.map((c) => [c.code, c]));
  const $ = (id) => document.getElementById(id);

  /* ---------- Настройки ---------- */

  const SETTINGS_KEY = "countries-quiz-settings";
  const settings = {
    flag: true, arms: false, capital: true, population: true, area: true, gdp: true, currency: true, language: true,
    capitalOnMap: true, sound: true, lang: null,
  };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch (e) { /* без сохранения */ }

  /* ---------- Языки ---------- */

  const STR = window.I18N;
  // Без сохранённого выбора — русский
  if (!STR[settings.lang]) settings.lang = "ru";
  const t = (key) => STR[settings.lang][key] ?? STR.ru[key];
  // Текст страны на текущем языке: name, capital, currency, language хранятся как { ru, en, zh }
  const tr = (c, field) => c[field]?.[settings.lang] ?? c[field]?.ru;
  const LOCALE = { ru: "ru-RU", en: "en-US", zh: "zh-CN" };
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

  const MODES = {
    countries: { ask: "askCountries", has: () => true, show: (c) => escapeHtml(tr(c, "name")) },
    capitals: { ask: "askCapitals", has: (c) => !!c.capital, show: (c) => escapeHtml(tr(c, "capital")) },
    flags: { ask: "askFlags", has: (c) => !!c.flag, show: (c) => `<img src="${c.flag}" alt="${t("flag")}">` },
  };

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* без сохранения */ }
  }

  /* ---------- Звуки (синтезируются, без файлов) ---------- */

  let audio = null;

  // type — тип волны или массив амплитуд гармоник (1-я, 2-я, ...) для своего тембра
  function tone(freq, start, duration, type = "sine", volume = 0.18, endFreq = freq) {
    const t = audio.currentTime + start;
    const osc = audio.createOscillator(), gain = audio.createGain();
    if (Array.isArray(type)) {
      const real = new Float32Array(type.length + 1), imag = Float32Array.from([0, ...type]);
      osc.setPeriodicWave(audio.createPeriodicWave(real, imag));
    } else {
      osc.type = type;
    }
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // Короткая вспышка шума через полосовой фильтр — «щелчок» в начале звука
  function noise(start, duration, centerFreq, volume) {
    const t = audio.currentTime + start;
    const length = Math.ceil(audio.sampleRate * duration);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
    src.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = centerFreq;
    filter.Q.value = 0.8;
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start(t);
  }

  // Тембры подобраны по спектру набора «клик-пум» на motovskikh.ru
  const CLICK_LOW = [1, 0.6, 0.6, 0.65, 0.1, 0.15];
  const CLICK_HIGH = [1, 0.65, 0.55, 0.75, 0.2];
  const THUMP = [1, 0.6, 0.45, 0.3, 0.1];
  const KNOCK = [1, 0.3, 0.15];

  const SOUNDS = {
    right: () => {
      noise(0, 0.006, 1800, 0.1);
      tone(330, 0, 0.045, CLICK_LOW, 0.2);
      noise(0.045, 0.006, 1800, 0.1);
      tone(440, 0.045, 0.06, CLICK_HIGH, 0.2);
    },
    wrong: () => {
      tone(400, 0, 0.045, KNOCK, 0.14);
      tone(110, 0.075, 0.15, THUMP, 0.13, 60);
    },
    win: () => [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, i * 0.12, i === 3 ? 0.5 : 0.16, "triangle", 0.2)),
    lose: () => [392, 349.2, 311.1, 261.6].forEach((f, i) => tone(f, i * 0.16, i === 3 ? 0.5 : 0.2, "triangle", 0.18)),
  };

  function play(name) {
    if (!settings.sound) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      SOUNDS[name]();
    } catch (e) { /* звук недоступен — играем молча */ }
  }

  /* ---------- Карта ---------- */

  const svg = $("map");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const viewport = el("g");
  svg.appendChild(viewport);
  viewport.appendChild(el("path", { d: DATA.sphere, class: "sphere" }));
  // Серые территории (не государства, спорные, ничейные) — кликабельны, по клику карточка с пояснением
  const otherLayer = viewport.appendChild(el("g"));
  const territories = {}; // code -> { ...данные, el }
  for (const o of DATA.other) {
    const path = otherLayer.appendChild(el("path", { d: o.d, class: "other" }));
    path.dataset.territory = o.code;
    territories[o.code] = { ...o, el: path };
  }

  const shapes = {}; // code -> [path, dot?]
  const countryLayer = el("g"), dotLayer = el("g");
  // Столицы — точки без подписей (название есть в карточке).
  // У стран-кружков точка лежит поверх кружка и появляется, когда сама страна на экране стала достаточно крупной.
  const capitalLayer = el("g", { class: "capitals" }), smallCapitalLayer = el("g", { class: "capitals" });
  const capitalDots = {}; // code -> circle
  // Столица выбранной страны — отдельный знак «кольцо с точкой», поверх всего
  const capitalMark = el("g", { class: "capitals capital-mark" });
  const markRing = capitalMark.appendChild(el("circle", { class: "mark-ring" }));
  const markCore = capitalMark.appendChild(el("circle", { class: "mark-core" }));
  viewport.append(countryLayer, capitalLayer, dotLayer, smallCapitalLayer, capitalMark);
  for (const c of DATA.countries) {
    if (c.capitalXY) {
      const layer = c.dot ? smallCapitalLayer : capitalLayer;
      capitalDots[c.code] = layer.appendChild(el("circle", { cx: c.capitalXY[0], cy: c.capitalXY[1], class: "capital", "data-country": c.code }));
    }
  }
  for (const c of DATA.countries) {
    const path = el("path", { d: c.d, class: "country" });
    path.dataset.code = c.code;
    countryLayer.appendChild(path);
    shapes[c.code] = [path];
    if (c.dot) {
      const dot = el("circle", { cx: c.dot[0], cy: c.dot[1], r: DOT_RADIUS, class: "dot" });
      dot.dataset.code = c.code;
      dotLayer.appendChild(dot);
      shapes[c.code].push(dot);
    }
  }

  function el(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function setClass(code, cls, on) {
    for (const s of shapes[code]) s.classList.toggle(cls, on);
  }

  /* ---------- Масштаб и перетаскивание ---------- */

  const view = { k: 1, x: 0, y: 0 };

  function applyView() {
    view.k = Math.min(MAX_ZOOM, Math.max(1, view.k));
    view.x = Math.min(0, Math.max(W * (1 - view.k), view.x));
    view.y = Math.min(0, Math.max(H * (1 - view.k), view.y));
    viewport.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
    // Кружки мелких стран почти не растут на экране при приближении и становятся прозрачнее,
    // чтобы сквозь них был виден контур самой страны
    const r = DOT_RADIUS / Math.pow(view.k, 0.8);
    for (const dot of dotLayer.children) dot.setAttribute("r", r);
    dotLayer.style.setProperty("--dot-fill", String(Math.max(0.12, 0.9 - 0.39 * Math.log2(view.k))));
    // Размеры знаков столиц задаём в пикселях экрана; при приближении они растут,
    // а на большом экране они изначально крупнее
    const pxPerUnit = (svg.getScreenCTM()?.a || 1) * view.k;
    const screen = Math.min(1.8, Math.max(1, svg.clientWidth / 1100));
    const grow = screen * Math.min(4, Math.pow(view.k, 0.3));
    const cr = (1.3 * grow) / pxPerUnit;
    for (const dot of capitalLayer.children) dot.setAttribute("r", cr);
    for (const dot of smallCapitalLayer.children) {
      dot.setAttribute("r", cr);
      const visible = view.k >= SMALL_CAPITAL_ALWAYS_ZOOM || smallSize(dot) * pxPerUnit >= SMALL_CAPITAL_MIN_PX;
      dot.style.display = visible ? "" : "none";
    }
    // На обзорном масштабе точки бледнее, к приближению ×4 — в полную силу
    const fade = String(Math.min(1, 0.55 + 0.45 * Math.log(view.k) / Math.log(4)));
    capitalLayer.style.opacity = smallCapitalLayer.style.opacity = fade;
    capitalMark.style.display = selectedCapital && selectedCapital.style.display !== "none" ? "" : "none";
    markRing.setAttribute("r", (3.6 * grow) / pxPerUnit);
    markCore.setAttribute("r", (1.4 * grow) / pxPerUnit);
    updateScaleBar();
  }

  /* ---------- Линейка масштаба ---------- */

  const SCALE_MAX_PX = 110;

  // Км на единицу карты по параллели на высоте y (таблица по градусам широты, между ними — линейно)
  function kmPerUnit(y) {
    const table = DATA.scaleBar;
    let i = table.findIndex(([ty]) => ty >= y);
    if (i <= 0) return table[Math.max(i, 0)][1];
    const [y0, k0] = table[i - 1], [y1, k1] = table[i];
    return k0 + (k1 - k0) * (y - y0) / (y1 - y0);
  }

  // Масштаб берём по широте центра видимой части карты
  function updateScaleBar() {
    const ctm = svg.getScreenCTM();
    if (!ctm || !ctm.a) return;
    const kmPerPx = kmPerUnit((H / 2 - view.y) / view.k) / (ctm.a * view.k);
    const maxKm = kmPerPx * SCALE_MAX_PX;
    const pow = Math.pow(10, Math.floor(Math.log10(maxKm)));
    const km = [5, 2, 1].map((m) => m * pow).find((v) => v <= maxKm);
    $("scaleLine").style.width = `${Math.round(km / kmPerPx)}px`;
    $("scaleLabel").textContent = `${km.toLocaleString(LOCALE[settings.lang])} ${t("km")}`;
  }

  window.addEventListener("resize", () => applyView());

  // Размер контура страны-кружка в единицах карты (по большей стороне), считается один раз
  const smallSizes = new Map();
  function smallSize(dot) {
    if (!smallSizes.has(dot)) {
      const box = shapes[dot.dataset.country][0].getBBox();
      smallSizes.set(dot, Math.max(box.width, box.height));
    }
    return smallSizes.get(dot);
  }

  let selectedCapital = null;
  function selectCapital(code) {
    selectedCapital?.classList.remove("selected");
    selectedCapital = capitalDots[code] || null;
    selectedCapital?.classList.add("selected");
    if (selectedCapital) {
      for (const c of [markRing, markCore]) {
        c.setAttribute("cx", selectedCapital.getAttribute("cx"));
        c.setAttribute("cy", selectedCapital.getAttribute("cy"));
      }
      // Перезапуск анимации появления
      capitalMark.classList.remove("pop");
      void capitalMark.getBBox();
      capitalMark.classList.add("pop");
    }
    applyView();
  }

  function showCapitals() {
    for (const layer of [capitalLayer, smallCapitalLayer, capitalMark]) layer.style.visibility = settings.capitalOnMap ? "" : "hidden";
  }

  function toSvgPoint(clientX, clientY) {
    const p = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }

  function zoomAt(factor, clientX, clientY) {
    const p = toSvgPoint(clientX, clientY);
    const k = Math.min(MAX_ZOOM, Math.max(1, view.k * factor));
    view.x = p.x - (p.x - view.x) * (k / view.k);
    view.y = p.y - (p.y - view.y) * (k / view.k);
    view.k = k;
    applyView();
  }

  function zoomCenter(factor) {
    const r = svg.getBoundingClientRect();
    zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });

  $("zoomIn").onclick = () => zoomCenter(1.6);
  $("zoomOut").onclick = () => zoomCenter(1 / 1.6);
  $("zoomReset").onclick = () => { view.k = 1; view.x = view.y = 0; applyView(); };

  // Клик определяем сами по pointerdown/pointerup: так перетаскивание не засчитывается как ответ
  const pointers = new Map();
  let press = null; // { code, x, y, moved }
  let pinch = null;

  svg.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      press = { code: e.target.dataset.code || null, territory: e.target.dataset.territory || null, x: e.clientX, y: e.clientY, moved: false };
    } else if (pointers.size === 2) {
      press = null;
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  });

  svg.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) { hover(e); return; }
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);

    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(dist / pinch.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.dist = dist;
      return;
    }
    if (press && !press.moved && Math.hypot(cur.x - press.x, cur.y - press.y) > DRAG_THRESHOLD) {
      press.moved = true;
      svg.classList.add("dragging");
      hideTooltip();
    }
    if (press && press.moved) {
      const p0 = toSvgPoint(prev.x, prev.y), p1 = toSvgPoint(cur.x, cur.y);
      view.x += p1.x - p0.x;
      view.y += p1.y - p0.y;
      applyView();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    svg.classList.remove("dragging");
    if (e.type === "pointerup" && press && !press.moved) {
      if (press.code) onCountryClick(press.code, e.clientX, e.clientY);
      else if (press.territory) showTerritoryCard(press.territory, e.clientX, e.clientY);
      else hideCard();
    }
    if (pointers.size === 0) press = null;
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("pointerleave", hideTooltip);

  /* ---------- Подсказка с названием (только для отгаданных) ---------- */

  const tooltip = $("tooltip");
  let hovered = null, hoveredTerritory = null;

  function hover(e) {
    const code = e.target.dataset.code || null;
    if (code !== hovered) {
      if (hovered) setClass(hovered, "hover", false);
      if (code) setClass(code, "hover", true);
      hovered = code;
    }
    const terr = territories[e.target.dataset.territory] || null;
    if (terr !== hoveredTerritory) {
      hoveredTerritory?.el.classList.remove("hover");
      terr?.el.classList.add("hover");
      hoveredTerritory = terr;
    }
    if ((code && (game.over || game.results[code])) || terr) {
      const r = $("mapWrap").getBoundingClientRect();
      tooltip.textContent = terr ? tr(terr, "name") : tr(byCode[code], "name");
      tooltip.style.left = e.clientX - r.left + "px";
      tooltip.style.top = e.clientY - r.top + "px";
      tooltip.hidden = false;
    } else {
      tooltip.hidden = true;
    }
  }

  function hideTooltip() {
    tooltip.hidden = true;
    if (hovered) setClass(hovered, "hover", false);
    hovered = null;
    hoveredTerritory?.el.classList.remove("hover");
    hoveredTerritory = null;
  }

  /* ---------- Карточка страны ---------- */

  const card = $("card");
  const fmt = (n) => n.toLocaleString(LOCALE[settings.lang]);

  // Место по ВВП среди стран, по которым есть данные
  const gdpRanked = DATA.countries.filter((c) => c.gdp).sort((a, b) => b.gdp - a.gdp);
  const gdpRank = Object.fromEntries(gdpRanked.map((c, i) => [c.code, i + 1]));
  const gdpText = (c) => !c.gdp ? t("noData")
    : `<span class="nowrap" title="${t("gdpRankTitle")}">${fmt(c.gdp)} $ (${gdpRank[c.code]}/${gdpRanked.length}) <small>(${c.gdpYear})</small></span>`;

  let cardState = null; // что сейчас в карточке — чтобы перерисовать при смене настроек

  // verdict — функция, возвращающая текст: так карточку можно перерисовать на другом языке
  function showCard(code, verdict, verdictClass, clientX, clientY) {
    cardState = { code, verdict, verdictClass, clientX, clientY };
    $("cardNote").hidden = true;
    const c = byCode[code];
    $("cardVerdict").textContent = verdict ? verdict() : "";
    $("cardVerdict").className = "card-verdict " + (verdictClass || "");
    $("cardName").textContent = tr(c, "name");
    selectCapital(code);

    setImage("cardFlag", c.flag, t("noFlag"));
    setImage("cardArms", c.arms, t("noArms"));
    $("cardArmsCaption").textContent = t(c.armsIsEmblem ? "emblem" : "arms");
    $("cardFlag").parentElement.hidden = !settings.flag;
    $("cardArms").parentElement.hidden = !settings.arms;
    document.querySelector(".card-images").hidden = !settings.flag && !settings.arms;

    const currency = tr(c, "currency"), language = tr(c, "language");
    const sep = settings.lang === "zh" ? "、" : ", ";
    const facts = [
      ["capital", t("capital"), c.capital ? escapeHtml(tr(c, "capital")) : t("noCapital")],
      ["population", t("population"), c.population ? `${fmt(c.population)} <small>(${c.populationYear})</small>` : t("noPopulation")],
      ["area", t("area"), c.area ? `${fmt(c.area)} ${t("km2")}` : "—"],
      ["gdp", `<span title="${t("gdpTitle")}">${t("gdp")}</span>`, gdpText(c)],
      ["currency", t(currency.length > 1 ? "currencies" : "currency"), escapeHtml(currency.join(sep)) || "—"],
      ["language", t(language.length > 1 ? "languages" : "language"), escapeHtml(language.join(sep)) || "—"],
    ].filter(([field]) => settings[field]);
    $("cardFacts").innerHTML = facts.map(([, k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

    card.hidden = false;
    placeCard(shapes[code], capitalPoint(code), clientX, clientY);
  }

  // Карточка серой территории: что это, кому принадлежит и почему не участвует в тесте
  function showTerritoryCard(code, clientX, clientY) {
    cardState = { territory: code, clientX, clientY };
    const o = territories[code];
    selectCapital(null);
    $("cardVerdict").textContent = "";
    $("cardVerdict").className = "card-verdict";
    $("cardName").textContent = tr(o, "name");
    document.querySelector(".card-images").hidden = true;
    const names = (codes) => escapeHtml(codes.map((c) => tr(byCode[c], "name")).join(settings.lang === "zh" ? "、" : ", "));
    const rows = [
      [t("terrStatus"), t("terr_" + o.kind)],
      o.owner && [t("terrOwner"), names(o.owner)],
      o.control && [t("terrControl"), names(o.control)],
      o.claim && [t("terrClaim"), names(o.claim)],
      o.neither && [t("terrNeither"), names(o.neither)],
    ].filter(Boolean);
    $("cardFacts").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    const why = { disputed: "whyDisputed", border: "whyDisputed", nullius: "whyNullius", ata: "whyAntarctica" }[o.kind] || "whyNotState";
    $("cardNote").textContent = t(why);
    $("cardNote").hidden = false;
    card.hidden = false;
    placeCard([o.el], null, clientX, clientY);
  }

  // Столица страны на экране (если её знак показан) — её карточка старается не закрывать
  function capitalPoint(code) {
    const dot = capitalDots[code];
    if (!dot || !settings.capitalOnMap || dot.style.display === "none") return null;
    return new DOMPoint(+dot.getAttribute("cx"), +dot.getAttribute("cy")).matrixTransform(dot.getScreenCTM());
  }

  function setImage(id, src, emptyText) {
    const img = $(id);
    const figure = img.parentElement;
    figure.querySelector(".none")?.remove();
    if (src) {
      img.hidden = false;
      // пока новая картинка грузится, браузер показывает старую — прячем её до загрузки
      img.style.visibility = "hidden";
      img.onload = img.onerror = () => { img.style.visibility = ""; };
      img.src = src;
      if (img.complete) img.style.visibility = "";
    } else {
      img.hidden = true;
      img.removeAttribute("src");
      const none = document.createElement("div");
      none.className = "none";
      none.textContent = emptyText;
      figure.prepend(none);
    }
  }

  // Карточку ставим так, чтобы она по возможности не закрывала саму страну (карту не двигаем).
  // Видимую часть страны рисуем в маленький canvas (1 пиксель = CELL пикселей экрана),
  // по нему строим таблицу накопленных сумм и перебираем положения карточки:
  // цена = закрытая площадь страны + большой штраф за закрытую столицу + немного за удалённость от клика.
  const CELL = 8;
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });

  function shapeMask(elements, cols, rows) {
    maskCanvas.width = cols;
    maskCanvas.height = rows;
    const ctx = maskCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cols, rows);
    // Только то, что видно в окне карты
    const r = svg.getBoundingClientRect();
    ctx.beginPath();
    ctx.rect(r.left / CELL, r.top / CELL, r.width / CELL, r.height / CELL);
    ctx.clip();
    ctx.fillStyle = "#000";
    for (const s of elements) {
      const m = s.getScreenCTM();
      if (!m) continue;
      ctx.setTransform(m.a / CELL, m.b / CELL, m.c / CELL, m.d / CELL, m.e / CELL, m.f / CELL);
      if (s.tagName === "path") ctx.fill(new Path2D(s.getAttribute("d")));
      else {
        ctx.beginPath();
        ctx.arc(+s.getAttribute("cx"), +s.getAttribute("cy"), +s.getAttribute("r"), 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    const data = ctx.getImageData(0, 0, cols, rows).data;
    // sum[(y)*(cols+1)+x] — сколько закрашенных клеток в прямоугольнике [0,x)×[0,y)
    const sum = new Float64Array((cols + 1) * (rows + 1));
    for (let y = 0; y < rows; y++) {
      let row = 0;
      for (let x = 0; x < cols; x++) {
        row += data[(y * cols + x) * 4 + 3] / 255;
        sum[(y + 1) * (cols + 1) + x + 1] = sum[y * (cols + 1) + x + 1] + row;
      }
    }
    return (x0, y0, x1, y1) => { // клетки, полуинтервалы
      x0 = Math.max(0, Math.min(cols, x0)); x1 = Math.max(0, Math.min(cols, x1));
      y0 = Math.max(0, Math.min(rows, y0)); y1 = Math.max(0, Math.min(rows, y1));
      const W1 = cols + 1;
      return sum[y1 * W1 + x1] - sum[y0 * W1 + x1] - sum[y1 * W1 + x0] + sum[y0 * W1 + x0];
    };
  }

  // elements — контур страны или территории, cap — точка столицы на экране (или null), x, y — место клика
  function placeCard(elements, cap, x, y) {
    if (window.matchMedia("(max-width: 640px)").matches) return; // на телефоне — снизу, через CSS
    const margin = 12;
    const w = card.offsetWidth, h = card.offsetHeight;
    // Держим карточку в пределах карты (не на панели сверху), если она туда помещается
    const r = svg.getBoundingClientRect();
    let minL = Math.max(margin, r.left + margin), maxL = Math.min(innerWidth, r.right) - w - margin;
    let minT = Math.max(margin, r.top + margin), maxT = Math.min(innerHeight, r.bottom) - h - margin;
    if (maxL < minL) { minL = margin; maxL = Math.max(margin, innerWidth - w - margin); }
    if (maxT < minT) { minT = margin; maxT = Math.max(margin, innerHeight - h - margin); }

    const cols = Math.ceil(innerWidth / CELL), rows = Math.ceil(innerHeight / CELL);
    const none = () => 0;
    let covered = none, coveredTarget = none;
    try { covered = shapeMask(elements, cols, rows); } catch (e) { /* без учёта страны */ }
    // Страну, которую сейчас надо найти, тоже по возможности не закрываем (но с меньшим весом)
    const target = game.over ? null : current();
    if (target && shapes[target] !== elements) {
      try { coveredTarget = shapeMask(shapes[target], cols, rows); } catch (e) { /* без учёта */ }
    }
    if (cap && !(cap.x > r.left && cap.x < r.right && cap.y > r.top && cap.y < r.bottom)) cap = null;
    // Плашка с вопросом внизу — её тоже лучше не закрывать
    const q = $("question");
    const qr = q.hidden ? null : q.getBoundingClientRect();

    const CAP_PAD = 14, TARGET_WEIGHT = 0.6, area = w * h;
    let best = null;
    const tryAt = (left, top) => {
      const cx0 = Math.floor(left / CELL), cy0 = Math.floor(top / CELL);
      const cx1 = Math.ceil((left + w) / CELL), cy1 = Math.ceil((top + h) / CELL);
      let cost = (covered(cx0, cy0, cx1, cy1) + TARGET_WEIGHT * coveredTarget(cx0, cy0, cx1, cy1)) * CELL * CELL;
      if (cap && cap.x > left - CAP_PAD && cap.x < left + w + CAP_PAD && cap.y > top - CAP_PAD && cap.y < top + h + CAP_PAD) cost += area;
      if (qr) {
        const ox = Math.min(left + w, qr.right) - Math.max(left, qr.left);
        const oy = Math.min(top + h, qr.bottom) - Math.max(top, qr.top);
        if (ox > 0 && oy > 0) cost += ox * oy * 0.5;
      }
      // Ближе к месту клика — лучше (расстояние от точки клика до карточки)
      const dx = Math.max(left - x, 0, x - left - w), dy = Math.max(top - y, 0, y - top - h);
      cost += Math.hypot(dx, dy) * 2;
      if (!best || cost < best.cost) best = { cost, left, top };
    };
    // Прежнее положение (справа от клика, слева — если не влезает) — как исходный вариант
    const gap = 18;
    let left0 = x + gap;
    if (left0 + w > innerWidth - margin) left0 = x - gap - w;
    tryAt(Math.max(minL, Math.min(left0, maxL)), Math.max(minT, Math.min(y - h / 3, maxT)));
    const step = CELL * 2;
    for (let top = minT; top <= maxT + 0.5; top += step) {
      for (let left = minL; left <= maxL + 0.5; left += step) tryAt(left, top);
      tryAt(maxL, top);
    }
    for (let left = minL; left <= maxL + 0.5; left += step) tryAt(left, maxT);
    tryAt(maxL, maxT);

    card.style.left = best.left + "px";
    card.style.top = best.top + "px";
  }

  function hideCard() { card.hidden = true; cardState = null; selectCapital(null); }

  function redrawCard() {
    if (cardState?.territory) showTerritoryCard(cardState.territory, cardState.clientX, cardState.clientY);
    else if (cardState) showCard(cardState.code, cardState.verdict, cardState.verdictClass, cardState.clientX, cardState.clientY);
  }
  $("cardClose").onclick = hideCard;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCard(); });

  /* ---------- Игра ---------- */

  const game = { mode: "countries", queue: [], index: 0, attempts: 0, hinted: false, results: {}, over: true, started: 0, timer: 0 };

  const current = () => game.queue[game.index];

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startGame(mode) {
    for (const code in shapes) for (const cls of ["s1", "s2", "s3", "s4", "hint", "flash"]) setClass(code, cls, false);
    Object.assign(game, {
      mode, index: 0, attempts: 0, hinted: false, results: {}, over: false, started: Date.now(),
      queue: shuffle(DATA.countries.filter(MODES[mode].has).map((c) => c.code)),
    });
    clearInterval(game.timer);
    game.timer = setInterval(updateTimer, 250);
    $("dunnoBtn").disabled = $("enoughBtn").disabled = false;
    hideCard();
    updateTimer();
    $("question").hidden = false;
    showQuestion();
  }

  function showQuestion() {
    const mode = MODES[game.mode];
    $("questionLabel").textContent = t(mode.ask);
    $("questionValue").innerHTML = mode.show(byCode[current()]);
    setProgress(game.index);
  }

  function setProgress(done) {
    const total = game.queue.length;
    $("progress").textContent = `${done} ${t("of")} ${total}`;
    $("progressBar").style.width = total ? `${(done / total) * 100}%` : "0";
  }

  function updateTimer() {
    const s = Math.floor((Date.now() - game.started) / 1000);
    $("timer").textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  function onCountryClick(code, x, y) {
    if (game.over) { showCard(code, "", "", x, y); return; }

    if (game.results[code]) { showCard(code, () => t("known"), "known", x, y); return; }

    const target = current();
    if (code === target) {
      const result = game.hinted ? 4 : game.attempts + 1;
      game.results[code] = result;
      setClass(code, "hint", false);
      setClass(code, "s" + result, true);
      const verdict = result === 4 ? "remember" : "right";
      toast(t(verdict));
      play("right");
      next(); // сначала следующий вопрос — чтобы карточка не закрывала уже новую страну
      if (!game.over) showCard(code, () => t(verdict) + " " + t("thisIs"), "right", x, y);
      return;
    }

    game.attempts++;
    play("wrong");
    flash(code);
    const wrong = Math.floor(Math.random() * STR.ru.wrong.length);
    showCard(code, () => t("wrong")[wrong] + " " + t("thisIs"), "wrong", x, y);
    if (game.attempts >= 3) giveHint();
  }

  function giveHint() {
    game.hinted = true;
    setClass(current(), "hint", true);
  }

  function next() {
    game.index++;
    game.attempts = 0;
    game.hinted = false;
    if (game.index >= game.queue.length) finish();
    else showQuestion();
  }

  function flash(code) {
    setClass(code, "flash", true);
    setTimeout(() => setClass(code, "flash", false), 450);
  }

  let toastTimer = 0;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 900);
  }

  function finish() {
    game.over = true;
    clearInterval(game.timer);
    updateTimer();
    if (game.queue[game.index]) setClass(game.queue[game.index], "hint", false);
    $("dunnoBtn").disabled = $("enoughBtn").disabled = true;
    hideCard();
    $("question").hidden = true;
    setProgress(Object.keys(game.results).length);

    const counts = [0, 0, 0, 0, 0];
    for (const r of Object.values(game.results)) counts[r]++;
    const total = game.queue.length;
    const skipped = total - Object.keys(game.results).length;
    const score = Math.round(((counts[1] * 3 + counts[2] * 2 + counts[3]) / (total * 3)) * 100);
    game.end = { counts, skipped, score, time: $("timer").textContent };
    renderEnd();
    $("endModal").hidden = false;
    play(score >= 65 ? "win" : "lose");
  }

  function renderEnd() {
    if (!game.end) return;
    const { counts, skipped, score, time } = game.end;
    const level = [85, 65, 40].find((n) => score >= n);
    $("endTitle").textContent = score === 100 ? t("perfect")
      : level ? t("know")[level].replace("{mode}", t("modeWhat")[game.mode]) : t("growRoom");
    $("endScore").textContent = score + "%";
    const rows = [
      ["var(--first)", t("first"), counts[1]],
      ["var(--second)", t("second"), counts[2]],
      ["var(--third)", t("third"), counts[3]],
      ["var(--failed)", t("failed"), counts[4]],
    ];
    if (skipped) rows.push(["var(--land)", t("skipped"), skipped]);
    rows.push(["transparent", t("time"), time]);
    $("endStats").innerHTML = rows.map(([color, label, n]) => `<li><i style="background:${color}"></i>${label}</li><li><b>${n}</b></li>`).join("");
  }

  /* ---------- Кнопки ---------- */

  $("dunnoBtn").onclick = () => { if (!game.over && !game.hinted) { play("wrong"); game.attempts = 3; giveHint(); } };
  $("enoughBtn").onclick = () => { if (!game.over) finish(); };
  $("menuBtn").onclick = () => { hideCard(); $("startModal").hidden = false; };
  $("startBtn").onclick = () => {
    $("startModal").hidden = true;
    startGame(document.querySelector("input[name=mode]:checked").value);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || $("startModal").hidden || !$("settingsModal").hidden) return;
    if (e.target.closest("button, summary, a")) return;
    e.preventDefault();
    $("startBtn").click();
  });
  $("againBtn").onclick = () => { $("endModal").hidden = true; startGame(game.mode); };
  $("inspectBtn").onclick = () => { $("endModal").hidden = true; };

  function renderSoundButton() {
    $("soundBtn").classList.toggle("muted", !settings.sound);
    $("soundBtn").title = t(settings.sound ? "soundOn" : "soundOff");
  }
  $("soundBtn").onclick = () => { settings.sound = !settings.sound; saveSettings(); renderSoundButton(); };

  for (const box of document.querySelectorAll("#settingsModal input[data-field]")) {
    box.checked = settings[box.dataset.field];
    box.onchange = () => {
      settings[box.dataset.field] = box.checked;
      saveSettings();
      showCapitals();
      redrawCard();
    };
  }

  // Переводит статичные тексты страницы и перерисовывает всё, что уже показано
  function applyLanguage() {
    document.documentElement.lang = settings.lang === "zh" ? "zh-Hans" : settings.lang;
    document.title = t("appTitle");
    for (const node of document.querySelectorAll("[data-t]")) node.textContent = t(node.dataset.t);
    for (const node of document.querySelectorAll("[data-t-title]")) node.title = t(node.dataset.tTitle);
    for (const node of document.querySelectorAll("[data-t-aria]")) node.setAttribute("aria-label", t(node.dataset.tAria));
    for (const li of $("langMenu").children) {
      const on = li.dataset.lang === settings.lang;
      li.setAttribute("aria-selected", on);
      if (on) { $("langFlag").src = li.querySelector("img").src; $("langCode").textContent = li.dataset.code; }
    }
    updateScaleBar();
    renderSoundButton();
    if (game.over) setProgress(Object.keys(game.results).length);
    else showQuestion();
    renderEnd();
    redrawCard();
    hideTooltip();
  }
  // Выпадающий список языков с флагами
  const langMenu = $("langMenu"), langBtn = $("langBtn");
  const setLangMenu = (open) => {
    langMenu.hidden = !open;
    langBtn.setAttribute("aria-expanded", open);
    if (open) (langMenu.querySelector('[aria-selected="true"]') || langMenu.firstElementChild).focus();
  };
  langBtn.onclick = (e) => { e.stopPropagation(); setLangMenu(langMenu.hidden); };
  langMenu.onclick = (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    setLangMenu(false);
    langBtn.focus();
    if (li.dataset.lang === settings.lang) return;
    settings.lang = li.dataset.lang;
    saveSettings();
    applyLanguage();
  };
  langMenu.onkeydown = (e) => {
    const items = [...langMenu.children], i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      document.activeElement.click();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.stopPropagation();
      setLangMenu(false);
      if (e.key === "Escape") langBtn.focus();
    }
  };
  document.addEventListener("click", (e) => { if (!langMenu.hidden && !e.target.closest("#langPicker")) setLangMenu(false); });
  const openSettings = () => { $("settingsModal").hidden = false; };
  $("settingsBtn").onclick = openSettings;
  $("startSettingsBtn").onclick = openSettings;
  $("settingsClose").onclick = () => { $("settingsModal").hidden = true; };

  applyLanguage();
  showCapitals();
  applyView();
})();
