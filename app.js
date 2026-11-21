(function () {
  "use strict";

  const DATA = window.QUIZ_DATA;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const W = DATA.width, H = DATA.height;
  // Предел приближения — в пикселях экрана на единицу карты (≈ ×150 на экране шириной 1400 px), а не в разах:
  // иначе на узком экране телефона, где вся карта мельче, приблизить можно было бы в 3–4 раза слабее, чем на ПК
  const MAX_PX_PER_UNIT = 130, MIN_MAX_ZOOM = 150;
  const maxZoom = () => Math.max(MIN_MAX_ZOOM, MAX_PX_PER_UNIT / (svg.getScreenCTM()?.a || 1));
  const SMALL_CAPITAL_MIN_PX = 24; // с какого размера страны-кружка на экране показывать её столицу
  const SMALL_CAPITAL_ALWAYS_ZOOM = 40; // при таком приближении столицы стран-кружков видны всегда
  // Столица остальных стран видна, когда её знак занимает не больше CAPITAL_MAX_SHARE площади той части
  // страны, где она стоит (без дальних островов и заморских земель), или когда приближение не меньше
  // CAPITAL_ALWAYS_ZOOM. Иначе на телефоне без зума Европа и Африка покрыты точками
  const CAPITAL_MAX_SHARE = 0.02, CAPITAL_ALWAYS_ZOOM = 12;
  const DOT_RADIUS = 4.5;
  // При приближении кружок перестаёт уменьшаться, когда дойдёт до своего «собственного» радиуса, и дальше
  // растёт вместе с картой. Этот радиус — по площади страны (круг той же площади ×DOT_AREA_SCALE + DOT_PAD),
  // а не описанный круг: у вытянутых стран (Палестина, Гамбия) описанный круг далеко залезал бы на соседей.
  // Радиусы соседних кружков ужимаются так, чтобы кружки не пересекались (Бахрейн и Катар)
  // У совсем мелких стран (основная часть — не дальше DOT_SMALL от точки кружка) кружок охватывает основную
  // часть целиком с запасом и не меньше DOT_MIN_OWN: такой круг закрывает лишь малую долю соседей (Ватикан — часть
  // Италии) или море (Бахрейн, Мальта), зато начинает расти вместе с картой уже примерно с ×4
  const DOT_AREA_SCALE = 1.1, DOT_PAD = 0.15, DOT_APART = 0.9;
  const DOT_SMALL = 1.5, DOT_SMALL_SCALE = 1.2, DOT_SMALL_PAD = 0.25, DOT_MIN_OWN = 1.5;
  const DRAG_THRESHOLD = 6;

  const byCode = Object.fromEntries(DATA.countries.map((c) => [c.code, c]));
  const $ = (id) => document.getElementById(id);

  /* ---------- Настройки ---------- */

  const SETTINGS_KEY = "countries-quiz-settings";
  const settings = {
    flag: true, arms: false, capital: true, population: true, area: true, gdp: true, currency: true, language: true,
    sound: true, lang: null, greyRings: false,
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
    // Обратный режим: страна подсвечена на карте, столицу пишут сами или выбирают из списка
    nameCapital: { ask: "askNameCapital", has: (c) => !!c.capital, show: (c) => escapeHtml(tr(c, "name")), answer: true },
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
  // Обводки, уходящие за край карты через линию перемены дат, обрезаются по её контуру
  viewport.appendChild(el("clipPath", { id: "sphereClip" })).appendChild(el("path", { d: DATA.sphere }));
  // Особые территории (не государства, спорные, ничейные) — кликабельны, по клику карточка с пояснением
  const otherLayer = viewport.appendChild(el("g"));
  const territories = {}; // code -> { ...данные, el }
  for (const o of DATA.other) {
    const path = otherLayer.appendChild(el("path", { d: o.d, class: "other" }));
    path.dataset.territory = o.code;
    territories[o.code] = { ...o, el: path, els: [path] };
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
  // Крошечные особые территории (остров Ханс, Гибралтар…) кружками не рисуем, чтобы их нельзя было
  // спутать с мелкими странами; видны они только при включённой обводке
  const capitalAreas = new Map(); // точка столицы -> площадь части страны со столицей, в единицах карты
  for (const c of DATA.countries) {
    if (c.capitalXY) {
      const layer = c.dot ? smallCapitalLayer : capitalLayer;
      const dot = layer.appendChild(el("circle", { cx: c.capitalXY[0], cy: c.capitalXY[1], class: "capital", "data-country": c.code }));
      capitalDots[c.code] = dot;
      if (!c.dot) capitalAreas.set(dot, capitalPartArea(c.d, c.capitalXY));
    }
  }

  // Площадь контура (из «M…L…Z» в d), внутри которого стоит столица; если ни в одном — самого большого
  function capitalPartArea(d, [px, py]) {
    let best = 0;
    for (const ring of d.split("Z")) {
      if (!ring.startsWith("M")) continue;
      const pts = ring.slice(1).split("L").map((p) => p.split(",").map(Number));
      let area = 0, inside = false;
      pts.forEach(([x, y], i) => {
        const [x2, y2] = pts[(i + 1) % pts.length];
        area += x * y2 - x2 * y;
        if ((y > py) !== (y2 > py) && px < x + ((py - y) * (x2 - x)) / (y2 - y)) inside = !inside;
      });
      area = Math.abs(area / 2);
      if (inside) return area;
      best = Math.max(best, area);
    }
    return best;
  }
  const dotCircles = new Map(); // circle -> собственный радиус в единицах карты
  for (const c of DATA.countries) {
    const path = el("path", { d: c.d, class: "country" });
    path.dataset.code = c.code;
    countryLayer.appendChild(path);
    shapes[c.code] = [path];
    if (c.dot && !c.outline) {
      const dot = el("circle", { cx: c.dot[0], cy: c.dot[1], r: DOT_RADIUS, class: "dot" });
      dot.dataset.code = c.code;
      dotCircles.set(dot, ownDotRadius(c));
      dotLayer.appendChild(dot);
      shapes[c.code].push(dot);
    }
  }

  // Обводка особых территорий (включается в настройках) — чтобы было видно, какие они вообще есть.
  // Силуэт o.outline (строит build-js.mjs) — одна выпуклая оболочка всех островов территории. Обводка идёт
  // на RING_GAP пикселей экрана от силуэта, так что это плавная выпуклая фигура при любом масштабе.
  // Контур рисуется маской: белое — силуэт, раздутый на RING_GAP + RING_WIDTH, чёрное — раздутый на RING_GAP;
  // видна только полоска между ними. Маска у каждой территории своя. Чтобы обводки соседних территорий
  // не пересекались, в маску большей добавлены (чёрным) раздутые силуэты меньших соседей: меньшая
  // обведена целиком, линия большей прерывается у неё (Синт-Мартен и Сен-Мартен, остров Ханс у Гренландии).
  // Внутри обводки территорию можно кликнуть: под картой лежит прозрачная фигура того же силуэта
  // (поэтому в этом режиме серые кружки крошечных территорий не нужны и скрыты).
  const RING_GAP = 6, RING_WIDTH = 1.5; // px
  const RING_PAD = 40; // запас вокруг силуэта в единицах карты — больше любой обводки при масштабе ×1 даже на телефоне
  const ringLayer = el("g", { class: "grey-rings" });
  const hitLayer = el("g", { class: "grey-hits" });
  const ringLabelLayer = el("g", { class: "grey-labels" }); // вне viewport: размер шрифта постоянный
  const ringLabels = [];

  // Рамки частей силуэта (o.outline из build-js.mjs) и всего силуэта. Частей больше одной только у оболочки,
  // пересекающей линию перемены дат: она нарисована у обоих краёв карты
  function silhouette(outline) {
    const parts = outline.split("Z").filter(Boolean).map((ring) => {
      const pts = ring.slice(1).split("L").map((p) => p.split(",").map(Number));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      let area = 0;
      pts.forEach(([x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; area += x * y2 - x2 * y; });
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), area: Math.abs(area / 2) };
    });
    const main = parts.reduce((p, q) => ((q.x1 - q.x0) * (q.y1 - q.y0) > (p.x1 - p.x0) * (p.y1 - p.y0) ? q : p));
    const box = { x0: Math.min(...parts.map((r) => r.x0)), y0: Math.min(...parts.map((r) => r.y0)), x1: Math.max(...parts.map((r) => r.x1)), y1: Math.max(...parts.map((r) => r.y1)) };
    // Обрезаем по краю карты только такие: у остальных обводка у края карты может выходить за него
    const clip = parts.length > 1 ? { "clip-path": "url(#sphereClip)" } : {};
    return { d: outline, clip, main, box, size: parts.reduce((s, r) => s + r.area, 0) };
  }
  const shapes2 = Object.values(territories).filter((o) => o.outline).map((o) => ({ o, ...silhouette(o.outline) }));
  // Сначала крупные: их кликабельные фигуры — снизу, чтобы мелкие соседи оставались доступны
  shapes2.sort((a, b) => b.size - a.size);
  shapes2.forEach((sh, n) => {
    const { o, d, box: b } = sh;
    const box = { x: b.x0 - RING_PAD, y: b.y0 - RING_PAD, width: b.x1 - b.x0 + 2 * RING_PAD, height: b.y1 - b.y0 + 2 * RING_PAD };
    const id = "greyRing" + n;
    const mask = ringLayer.appendChild(el("mask", { id, maskUnits: "userSpaceOnUse", ...box }));
    mask.appendChild(el("path", { class: "ring-outer", d }));
    mask.appendChild(el("path", { class: "ring-inner", d }));
    // Меньшие соседи вырезают свою зону из обводки этой территории
    for (const other of shapes2.slice(n + 1)) {
      const q = other.box;
      if (q.x0 > b.x1 + RING_PAD || q.x1 < b.x0 - RING_PAD || q.y0 > b.y1 + RING_PAD || q.y1 < b.y0 - RING_PAD) continue;
      mask.appendChild(el("path", { class: "ring-inner", d: other.d }));
    }
    ringLayer.appendChild(el("rect", { ...box, mask: `url(#${id})` }));
    const hit = hitLayer.appendChild(el("path", { class: "ring-hit", d }));
    hit.dataset.territory = o.code;
    // Подпись — у самого крупного куска: так видно, где какая территория. Клик по подписи — как по территории
    const label = ringLabelLayer.appendChild(el("text"));
    label.dataset.territory = o.code;
    o.ringBox = sh.main; // их карточка старается не закрывать обводку и подпись
    o.ringLabel = label;
    ringLabels.push({ o, box: sh.main, size: sh.size, el: label });
  });

  // Крупные территории подписываем первыми; подпись, наезжающая на уже поставленную, скрывается
  ringLabels.sort((a, b) => b.size - a.size);

  function placeRingLabels() {
    const ctm = svg.getScreenCTM(), rect = svg.getBoundingClientRect();
    const s = ctm?.a || 1; // px экрана на единицу viewBox
    // Подписи — в пикселях от левого верхнего угла самого svg. Карта вписана в него с полями (на телефоне —
    // сверху и снизу), поэтому начало viewBox сдвинуто на (ox, oy)
    const ox = ctm ? ctm.e - rect.left : 0, oy = ctm ? ctm.f - rect.top : 0;
    ringLabelLayer.setAttribute("transform", `scale(${1 / s}) translate(${-ox} ${-oy})`);
    const sw = svg.clientWidth, sh = svg.clientHeight;
    const off = RING_GAP + RING_WIDTH + 4, h = 13;
    const sx = (v) => ox + (view.x + v * view.k) * s, sy = (v) => oy + (view.y + v * view.k) * s;
    // Рамки обводок на экране. Подпись не должна залезать на чужую обводку: иначе в тесной группе
    // (Ангилья, Сен-Мартен, Синт-Мартен, Сен-Бартелеми на телефоне) подпись оказывается у соседнего
    // кружка и непонятно, что где. Не нашлось места — подпись скрыта, пока карту не приблизят
    const pad = RING_GAP + RING_WIDTH;
    const rings = ringLabels.map(({ box: b }) => [sx(b.x0) - pad, sy(b.y0) - pad, sx(b.x1) + pad, sy(b.y1) + pad]);
    const overlap = (r, q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3];
    const placed = [];
    for (const [i, l] of ringLabels.entries()) {
      l.el.textContent = tr(l.o, "name");
      l.el.style.display = "";
      const w = l.el.getComputedTextLength() + 6;
      const box = l.box;
      const [x0, x1, y0, y1] = [sx(box.x0), sx(box.x1), sy(box.y0), sy(box.y1)], cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // Места по очереди: над обводкой, под ней, справа, слева. [x, y базовой линии, выравнивание, рамка]
      const spots = [
        [cx, y0 - off, "middle", [cx - w / 2, y0 - off - h, cx + w / 2, y0 - off + 3]],
        [cx, y1 + off + h - 3, "middle", [cx - w / 2, y1 + off, cx + w / 2, y1 + off + h]],
        [x1 + off, cy + 4, "start", [x1 + off - 3, cy - h / 2, x1 + off + w, cy + h / 2]],
        [x0 - off, cy + 4, "end", [x0 - off - w, cy - h / 2, x0 - off + 3, cy + h / 2]],
      ];
      // Территория целиком за краем экрана — подпись не нужна
      if (x1 < 0 || x0 > sw || y1 < 0 || y0 > sh) { l.el.style.display = "none"; continue; }
      // Обводки, накрывающие собственную (Сен-Мартен у Синт-Мартена — это один остров: центр одной внутри
      // другой), не мешают: их не обойти, и подпись иначе пропала бы при любом приближении
      const inside = (p, q) => overlap([(p[0] + p[2]) / 2, (p[1] + p[3]) / 2, (p[0] + p[2]) / 2, (p[1] + p[3]) / 2], q);
      const blockers = rings.filter((q, j) => j !== i && !inside(q, rings[i]) && !inside(rings[i], q));
      const free = (r) => !placed.some((q) => overlap(r, q)) && !blockers.some((q) => overlap(r, q));
      const spot = spots.find(([, , , r]) => free(r));
      // За пределами экрана подпись не нужна и место не занимает
      if (!spot || spot[3][2] < 0 || spot[3][0] > sw || spot[3][3] < 0 || spot[3][1] > sh) { l.el.style.display = "none"; continue; }
      const [x0s, y, anchor, r] = spot;
      const shift = Math.max(4 - r[0], Math.min(0, sw - 4 - r[2])); // не вылезать за край экрана
      const x = x0s + shift;
      r[0] += shift; r[2] += shift;
      l.el.setAttribute("x", x);
      l.el.setAttribute("y", y);
      l.el.setAttribute("text-anchor", anchor);
      placed.push(r);
    }
  }


  // Островные государства с разбросанными островами (Тонга, Кирибати, Мальдивы…): вместо кружка на одном
  // острове — тонкая обводка всей территории, как у особых территорий (силуэт строит build-js.mjs).
  // Внутри обводки страну можно кликнуть; у отгаданной область внутри прозрачно закрашена цветом результата.
  // Слой — под особыми территориями, чтобы Майотта внутри обводки Комор оставалась доступна
  // Обводка тоньше, чем у особых территорий, — чтобы не отвлекала. У Кирибати и Фиджи фигура уходит за край
  // карты и выходит с другого (см. build-js.mjs)
  const ARCHI_WIDTH = 0.6; // px
  const archiLayer = el("g", { class: "archi" }), archiRingLayer = el("g", { class: "archi-rings" });
  viewport.insertBefore(archiLayer, otherLayer);
  viewport.insertBefore(archiRingLayer, capitalLayer);
  for (const c of DATA.countries) {
    if (!c.outline) continue;
    const { d, clip, box: b } = silhouette(c.outline);
    const box = { x: b.x0 - RING_PAD, y: b.y0 - RING_PAD, width: b.x1 - b.x0 + 2 * RING_PAD, height: b.y1 - b.y0 + 2 * RING_PAD };
    const id = "archiRing" + c.code;
    const mask = archiRingLayer.appendChild(el("mask", { id, maskUnits: "userSpaceOnUse", ...box }));
    mask.appendChild(el("path", { class: "ring-outer", d }));
    mask.appendChild(el("path", { class: "ring-inner", d }));
    archiRingLayer.appendChild(el("rect", { ...box, mask: `url(#${id})`, ...clip }));
    const area = archiLayer.appendChild(el("path", { class: "archi-area", d, ...clip }));
    area.dataset.code = c.code;
    shapes[c.code].push(area);
  }

  // Соседние кружки не должны пересекаться: больший уступает, пока сумма радиусов не станет DOT_APART расстояния
  {
    const list = [...dotCircles.keys()].map((dot) => ({ dot, x: +dot.getAttribute("cx"), y: +dot.getAttribute("cy") }));
    for (const a of list) for (const b of list) {
      if (a === b) continue;
      const room = DOT_APART * Math.hypot(a.x - b.x, a.y - b.y);
      const ra = dotCircles.get(a.dot), rb = dotCircles.get(b.dot);
      if (ra + rb <= room) continue;
      const [big, small] = ra > rb ? [a, b] : [b, a];
      const rs = Math.min(dotCircles.get(small.dot), room / 2);
      dotCircles.set(small.dot, rs);
      dotCircles.set(big.dot, room - rs);
    }
  }

  // Собственный радиус кружка страны-кружка в единицах карты (см. DOT_AREA_SCALE и DOT_SMALL)
  function ownDotRadius(c) {
    const rings = c.d.split("Z").filter(Boolean).map((ring) => {
      const pts = ring.slice(1).split("L").map((p) => p.split(",").map(Number));
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        a += x1 * y2 - x2 * y1;
      }
      return { pts, area: Math.abs(a) / 2 };
    });
    const byArea = DOT_AREA_SCALE * Math.sqrt(rings.reduce((s, r) => s + r.area, 0) / Math.PI) + DOT_PAD;
    const main = rings.reduce((a, b) => (b.area > a.area ? b : a));
    const reach = Math.max(...main.pts.map(([x, y]) => Math.hypot(x - c.dot[0], y - c.dot[1])));
    return reach <= DOT_SMALL ? Math.max(byArea, DOT_MIN_OWN, DOT_SMALL_SCALE * reach + DOT_SMALL_PAD) : byArea;
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
    view.k = Math.min(maxZoom(), Math.max(1, view.k));
    view.x = Math.min(0, Math.max(W * (1 - view.k), view.x));
    view.y = Math.min(0, Math.max(H * (1 - view.k), view.y));
    viewport.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
    // Кружки мелких стран сначала почти не растут на экране при приближении и становятся прозрачнее,
    // чтобы сквозь них был виден контур самой страны; дойдя до собственного радиуса, растут вместе с картой
    const r = DOT_RADIUS / Math.pow(view.k, 0.8);
    for (const [dot, own] of dotCircles) dot.setAttribute("r", Math.max(r, own));
    dotLayer.style.setProperty("--dot-fill", String(Math.max(0.12, 0.9 - 0.39 * Math.log2(view.k))));
    // Размеры знаков столиц задаём в пикселях экрана; при приближении они растут,
    // а на большом экране они изначально крупнее
    const pxPerUnit = (svg.getScreenCTM()?.a || 1) * view.k;
    const screen = Math.min(1.8, Math.max(1, svg.clientWidth / 1100));
    const grow = screen * Math.min(4, Math.pow(view.k, 0.3));
    const cr = (1.3 * grow) / pxPerUnit;
    const capArea = Math.PI * cr * cr;
    for (const dot of capitalLayer.children) {
      dot.setAttribute("r", cr);
      const visible = view.k >= CAPITAL_ALWAYS_ZOOM || capArea <= CAPITAL_MAX_SHARE * capitalAreas.get(dot);
      dot.style.display = visible ? "" : "none";
    }
    for (const dot of smallCapitalLayer.children) {
      dot.setAttribute("r", cr);
      const visible = view.k >= SMALL_CAPITAL_ALWAYS_ZOOM || smallSize(dot) * pxPerUnit >= SMALL_CAPITAL_MIN_PX;
      dot.style.display = visible ? "" : "none";
    }
    // На обзорном масштабе точки бледнее, к приближению ×4 — в полную силу
    const fade = String(Math.min(1, 0.55 + 0.45 * Math.log(view.k) / Math.log(4)));
    capitalLayer.style.opacity = smallCapitalLayer.style.opacity = fade;
    capitalMark.style.display = capitalShown(selectedCapital) ? "" : "none";
    markRing.setAttribute("r", (3.6 * grow) / pxPerUnit);
    markCore.setAttribute("r", (1.4 * grow) / pxPerUnit);
    viewport.style.setProperty("--ring-outer", (2 * (RING_GAP + RING_WIDTH)) / pxPerUnit);
    viewport.style.setProperty("--ring-inner", (2 * RING_GAP) / pxPerUnit);
    viewport.style.setProperty("--archi-outer", (2 * (RING_GAP + ARCHI_WIDTH)) / pxPerUnit);
    if (settings.greyRings) {
      if (!ringLayer.parentNode) { viewport.appendChild(ringLayer); viewport.insertBefore(hitLayer, otherLayer); }
      if (!ringLabelLayer.parentNode) svg.appendChild(ringLabelLayer);
      placeRingLabels();
    } else { ringLayer.remove(); hitLayer.remove(); ringLabelLayer.remove(); }
    svg.classList.toggle("grey-rings-on", settings.greyRings);
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

  // Виден ли знак столицы выбранной страны. У обычных стран — всегда, даже если сама точка скрыта
  // как слишком крупная для страны; у стран-кружков — только вместе с точкой (иначе знак закроет кружок)
  const capitalShown = (dot) => !!dot && (dot.parentNode === capitalLayer || dot.style.display !== "none");

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

  function toSvgPoint(clientX, clientY) {
    const p = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }

  function zoomAt(factor, clientX, clientY) {
    const p = toSvgPoint(clientX, clientY);
    const k = Math.min(maxZoom(), Math.max(1, view.k * factor));
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

  // Что под указателем: { code } страны или { territory }. При включённой обводке клик внутри кружка мелкой
  // особой территории (Бир-Тавиль, Гибралтар…) достаётся ей, а не соседней стране, которая лежит поверх
  // её прозрачной кликабельной фигуры. Только для мелких на экране: у крупных (Гренландия) выпуклый
  // силуэт может захватывать куски соседей, а их собственные границы и так хорошо видны
  const RING_PRIORITY_PX = 40;
  function pickTarget(e) {
    const code = e.target.dataset.code || null, territory = e.target.dataset.territory || null;
    if (code && settings.greyRings && hitLayer.parentNode) {
      for (const node of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (!node.classList?.contains("ring-hit")) continue;
        const r = node.getBoundingClientRect();
        if (Math.max(r.width, r.height) <= RING_PRIORITY_PX) return { code: null, territory: node.dataset.territory };
      }
    }
    return { code, territory };
  }

  svg.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      press = { ...pickTarget(e), x: e.clientX, y: e.clientY, moved: false };
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
    const target = pickTarget(e), code = target.code;
    if (code !== hovered) {
      if (hovered) setClass(hovered, "hover", false);
      if (code) setClass(code, "hover", true);
      hovered = code;
    }
    const terr = territories[target.territory] || null;
    if (terr !== hoveredTerritory) {
      for (const x of hoveredTerritory?.els || []) x.classList.remove("hover");
      for (const x of terr?.els || []) x.classList.add("hover");
      hoveredTerritory = terr;
    }
    // Над подписью территории название и так видно. Панель вопроса пропускает указатель к карте под ней,
    // но подсказка поверх вопроса мешает его читать
    const q = $("question"), qr = q.hidden ? null : q.getBoundingClientRect();
    const overQuestion = qr && e.clientX >= qr.left && e.clientX <= qr.right && e.clientY >= qr.top && e.clientY <= qr.bottom;
    const overLabel = e.target.parentNode === ringLabelLayer;
    if (!overQuestion && !overLabel && ((code && (game.over || game.results[code])) || terr)) {
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
    for (const x of hoveredTerritory?.els || []) x.classList.remove("hover");
    hoveredTerritory = null;
  }

  /* ---------- Карточка страны ---------- */

  const card = $("card");
  const fmt = (n) => n.toLocaleString(LOCALE[settings.lang]);

  // Место по ВВП среди стран, по которым есть данные
  const gdpRanked = DATA.countries.filter((c) => c.gdp).sort((a, b) => b.gdp - a.gdp);
  const gdpRank = Object.fromEntries(gdpRanked.map((c, i) => [c.code, i + 1]));
  // У особых территорий места в рейтинге нет — он только среди стран
  const gdpText = (c) => !c.gdp ? t("noData") : gdpRank[c.code]
    ? `<span class="nowrap" title="${t("gdpRankTitle")}">${fmt(c.gdp)} $ (${gdpRank[c.code]}/${gdpRanked.length}) <small>(${c.gdpYear})</small></span>`
    : `<span class="nowrap">${fmt(c.gdp)} $ <small>(${c.gdpYear})</small></span>`;

  let cardState = null; // что сейчас в карточке — чтобы перерисовать при смене настроек

  // verdict — функция, возвращающая текст: так карточку можно перерисовать на другом языке
  function showCard(code, verdict, verdictClass, clientX, clientY) {
    cardState = { code, verdict, verdictClass, clientX, clientY };
    $("cardNote").hidden = true;
    const c = byCode[code];
    $("cardVerdict").textContent = verdict ? verdict() : "";
    $("cardVerdict").className = "card-verdict " + (verdictClass || "");
    setCardName(tr(c, "name"), c.wiki && ruwikiUrl(c.wiki));
    selectCapital(code);

    showImages(c);
    $("cardFacts").innerHTML = factsHtml(c, false);

    card.hidden = false;
    placeCard(shapes[code], capitalPoint(code), clientX, clientY);
  }

  const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const ruwikiUrl = (title) => "https://ru.ruwiki.ru/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
  // Текст — ссылка на статью Рувики, если она известна
  const wikiLink = (text, title) => title
    ? `<a href="${ruwikiUrl(title)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>` : escapeHtml(text);

  function showImages(c) {
    setImage("cardFlag", c.flag, t("noFlag"));
    setImage("cardArms", c.arms, t("noArms"));
    $("cardArmsCaption").textContent = t(c.armsIsEmblem ? "emblem" : "arms");
    $("cardFlag").parentElement.hidden = !settings.flag;
    $("cardArms").parentElement.hidden = !settings.arms;
    document.querySelector(".card-images").hidden = !settings.flag && !settings.arms;
  }

  // Строки карточки: столица, население, площадь, ВВП, валюта, языки — какие выбраны в настройках.
  // knownOnly (особые территории): строк без данных нет вовсе, а не «нет данных»
  function factRows(c, knownOnly) {
    const currency = tr(c, "currency"), language = tr(c, "language");
    const sep = settings.lang === "zh" ? "、" : ", ";
    const year = (y) => (y ? ` <small>(${y})</small>` : "");
    const rows = [
      ["capital", t("capital"), capitalAsked(c) ? null : c.capital ? wikiLink(tr(c, "capital"), c.capitalWiki) : !knownOnly && t("noCapital")],
      ["population", t("population"), c.population ? fmt(c.population) + year(c.populationYear)
        : c.population === 0 || !knownOnly ? t("noPopulation") : null],
      ["area", t("area"), c.area ? `${fmt(c.area)} ${t("km2")}` : !knownOnly && "—"],
      ["gdp", `<span title="${t("gdpTitle")}">${t("gdp")}</span>`, c.gdp || !knownOnly ? gdpText(c) : null],
      ["currency", t(currency.length > 1 ? "currencies" : "currency"),
        currency.map((x, i) => wikiLink(x, c.currencyWiki?.[i])).join(sep) || (!knownOnly && "—")],
      ["language", t(language.length > 1 ? "languages" : "language"), escapeHtml(language.join(sep)) || (!knownOnly && "—")],
    ];
    return rows.filter(([field, , v]) => settings[field] && v).map(([, k, v]) => [k, v]);
  }
  const factsHtml = (c, knownOnly, before = []) =>
    [...before, ...factRows(c, knownOnly)].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

  // Заголовок карточки — ссылка на статью в Рувики (если она есть)
  function setCardName(name, url) {
    $("cardName").innerHTML = url
      ? `<a href="${url}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`
      : escapeHtml(name);
  }

  // Статья Рувики о юридическом статусе территории (заголовки сверены с русской Википедией).
  // У «поделён между двумя странами» (остров Ханс) общей статьи нет — всё в статье о самом острове
  const STATUS_WIKI = {
    dep: "Зависимая территория", auto: "Автономная территория", crown: "Коронные земли",
    kingdom: "Королевство Нидерландов", assoc: "Ассоциированное государство",
    disputed: "Спорная территория", border: "Спорная территория",
    nullius: "Terra nullius", ata: "Договор об Антарктике",
  };

  // Карточка особой территории: что это, кому принадлежит, известные сведения (как у стран) и почему не участвует в тесте
  function showTerritoryCard(code, clientX, clientY) {
    cardState = { territory: code, clientX, clientY };
    const o = territories[code];
    selectCapital(null);
    $("cardVerdict").textContent = "";
    $("cardVerdict").className = "card-verdict";
    setCardName(tr(o, "name"), o.wikiSearch ? "https://ru.ruwiki.ru/w/index.php?search=" + encodeURIComponent(o.wiki) : ruwikiUrl(o.wiki));
    showImages(o);
    if (!o.flag) $("cardFlag").parentElement.hidden = true; // у территории без флага и герба места под картинки нет
    if (!o.arms) $("cardArms").parentElement.hidden = true;
    document.querySelector(".card-images").hidden = $("cardFlag").parentElement.hidden && $("cardArms").parentElement.hidden;
    const names = (codes) => escapeHtml(codes.map((c) => tr(byCode[c], "name")).join(settings.lang === "zh" ? "、" : ", "));
    const statusArticle = STATUS_WIKI[o.kind];
    const status = escapeHtml(capitalize(t("terr_" + o.kind)));
    const rows = [
      [t("terrStatus"), statusArticle ? `<a href="${ruwikiUrl(statusArticle)}" target="_blank" rel="noopener">${status}</a>` : status],
      o.owner && [t("terrOwner"), names(o.owner)],
      o.control && [t("terrControl"), names(o.control)],
      o.claim && [t("terrClaim"), names(o.claim)],
      o.neither && [t("terrNeither"), names(o.neither)],
    ].filter(Boolean);
    $("cardFacts").innerHTML = factsHtml(o, true, rows);
    const why = { disputed: "whyDisputed", border: "whyDisputed", nullius: "whyNullius", ata: "whyAntarctica" }[o.kind] || "whyNotState";
    $("cardNote").textContent = t(why);
    $("cardNote").hidden = false;
    card.hidden = false;
    placeCard(o.els, null, clientX, clientY, territoryKeepOut(o));
  }

  // Что ещё, кроме контура, карточка территории старается не закрывать (прямоугольники на экране).
  // Крошечная территория — это несколько пикселей контура, её закрытие почти ничего не «стоит»;
  // у стран такие места занимают кружки, а у территорий — обводка с подписью или зона вокруг островка
  const KEEP_PAD = 10, KEEP_MAX_PX = 40;
  function territoryKeepOut(o) {
    const rects = [];
    const sr = svg.getBoundingClientRect();
    if (settings.greyRings && o.ringBox) {
      const m = viewport.getScreenCTM();
      const p0 = new DOMPoint(o.ringBox.x0, o.ringBox.y0).matrixTransform(m);
      const p1 = new DOMPoint(o.ringBox.x1, o.ringBox.y1).matrixTransform(m);
      const pad = RING_GAP + RING_WIDTH + 2;
      if (p1.x - p0.x < sr.width / 2) rects.push([p0.x - pad, p0.y - pad, p1.x + pad, p1.y + pad]);
      const l = o.ringLabel;
      if (l.isConnected && l.style.display !== "none") {
        const r = l.getBoundingClientRect();
        rects.push([r.left, r.top, r.right, r.bottom]);
      }
    } else {
      const r = o.el.getBoundingClientRect();
      if (Math.max(r.width, r.height) <= KEEP_MAX_PX) rects.push([r.left - KEEP_PAD, r.top - KEEP_PAD, r.right + KEEP_PAD, r.bottom + KEEP_PAD]);
    }
    return rects;
  }

  // Столица страны на экране (если её знак показан) — её карточка старается не закрывать
  function capitalPoint(code) {
    const dot = capitalDots[code];
    if (!capitalShown(dot)) return null;
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
      img.onload = img.onerror = () => { img.style.visibility = ""; replaceCard(); };
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
  const BIG_SHAPE = 0.35; // страна закрывает больше этой доли карты — её не обходим
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

  // elements — контур страны или территории, cap — точка столицы на экране (или null), x, y — место клика,
  // keepOut — прямоугольники [left, top, right, bottom], которые тоже лучше не закрывать
  let lastPlace = null; // { args, h } — с чем ставили карточку в последний раз
  function placeCard(elements, cap, x, y, keepOut = []) {
    if (window.matchMedia("(max-width: 640px)").matches) return; // на телефоне — снизу, через CSS
    const margin = 12;
    const w = card.offsetWidth, h = card.offsetHeight;
    lastPlace = { args: [elements, cap, x, y, keepOut], h };
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
    // Страна занимает большую часть карты (Гренландия крупным планом) — закрыть её кусок не страшно,
    // а уводить карточку на край незачем: ставим её просто рядом с местом клика
    const mapCells = Math.max(1, (r.width / CELL) * (r.height / CELL));
    const big = covered(Math.floor(r.left / CELL), Math.floor(r.top / CELL), Math.ceil(r.right / CELL), Math.ceil(r.bottom / CELL)) > BIG_SHAPE * mapCells;
    if (big) covered = none;
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
      // Большую страну не обходим, но само место клика не закрываем
      if (big && x > left - CAP_PAD && x < left + w + CAP_PAD && y > top - CAP_PAD && y < top + h + CAP_PAD) cost += area;
      if (qr) {
        const ox = Math.min(left + w, qr.right) - Math.max(left, qr.left);
        const oy = Math.min(top + h, qr.bottom) - Math.max(top, qr.top);
        if (ox > 0 && oy > 0) cost += ox * oy * 0.5;
      }
      for (const [l, t, r, b] of keepOut) {
        const ox = Math.min(left + w, r) - Math.max(left, l), oy = Math.min(top + h, b) - Math.max(top, t);
        if (ox > 0 && oy > 0) cost += ox * oy * 2;
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

  // Флаг и герб догружаются после того, как место для карточки уже выбрано, и карточка вырастает вниз —
  // тогда выбираем место заново
  function replaceCard() {
    if (!card.hidden && lastPlace && card.offsetHeight !== lastPlace.h) placeCard(...lastPlace.args);
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
  // Режим, где отвечают столицей (а не кликом по карте)
  const answerMode = () => !game.over && MODES[game.mode].answer;
  // Столицу страны, о которой сейчас спрашивают, карточка не показывает — иначе это подсказка
  const capitalAsked = (c) => !!answerMode() && c.code === current();

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startGame(mode) {
    for (const code in shapes) for (const cls of ["s1", "s2", "s3", "s4", "hint", "flash", "target"]) setClass(code, cls, false);
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
    answerInput.value = "";
    showQuestion();
    if (MODES[mode].answer) focusAnswer();
  }

  function showQuestion() {
    const mode = MODES[game.mode];
    $("questionLabel").textContent = t(mode.ask);
    $("questionValue").innerHTML = mode.show(byCode[current()]);
    setProgress(game.index);
    $("question").classList.toggle("answering", !!mode.answer);
    document.body.classList.toggle("answering", !!mode.answer);
    $("answer").hidden = !mode.answer;
    answerInput.placeholder = t("answerPlaceholder");
    if (mode.answer) {
      setClass(current(), "target", true);
      showTarget(current());
    }
    closeAnswerList();
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
    // В режимах со столицами клик по карте — просто справка о стране
    if (game.over || answerMode()) { showCard(code, "", "", x, y); return; }

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
    if (current()) setClass(current(), "target", false);
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
    if (game.queue[game.index]) for (const cls of ["hint", "target"]) setClass(game.queue[game.index], cls, false);
    closeAnswerList();
    $("dunnoBtn").disabled = $("enoughBtn").disabled = true;
    hideCard();
    $("question").hidden = true;
    document.body.classList.remove("answering");
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

  /* ---------- Ответ столицей ---------- */

  const answerInput = $("answerInput"), answerList = $("answerList");

  // Сравниваем без регистра, диакритики (ё = е), пробелов, дефисов и пояснений в скобках
  const norm = (s) => s.replace(/\(.*?\)/g, "").normalize("NFD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  // Варианты ответа: название на любом из языков, а для «Washington, D.C.» — и часть до запятой
  function capitalVariants(c) {
    const out = new Set();
    for (const name of Object.values(c.capital)) {
      out.add(norm(name));
      if (name.includes(",")) out.add(norm(name.split(",")[0]));
    }
    out.delete("");
    return out;
  }
  const variants = Object.fromEntries(DATA.countries.filter((c) => c.capital).map((c) => [c.code, capitalVariants(c)]));

  // Расстояние Дамерау — Левенштейна (перестановка соседних букв — одна ошибка)
  function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }
  // Сколько опечаток прощаем: в коротких названиях — ни одной, в средних — одну, в длинных — две
  const typos = (len) => (len < 5 ? 0 : len < 9 ? 1 : 2);

  // Чья это столица: код страны (своя — с опечатками, чужая — только точно), null — такой нет, undefined — пусто
  function matchCapital(text) {
    const x = norm(text), target = current();
    if (!x) return undefined;
    if (variants[target].has(x)) return target;
    const other = Object.keys(variants).find((code) => variants[code].has(x));
    if (other) return other;
    for (const v of variants[target]) if (editDistance(x, v) <= typos(v.length)) return target;
    return null;
  }

  // Центр видимой части страны на экране — карточка ставится так, будто по этому месту кликнули
  function screenPoint(code) {
    const r = svg.getBoundingClientRect();
    let box = null;
    for (const s of shapes[code]) {
      const b = s.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      box = box ? { l: Math.min(box.l, b.left), t: Math.min(box.t, b.top), r: Math.max(box.r, b.right), b: Math.max(box.b, b.bottom) }
        : { l: b.left, t: b.top, r: b.right, b: b.bottom };
    }
    if (!box) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const l = Math.max(box.l, r.left), tp = Math.max(box.t, r.top), rr = Math.min(box.r, r.right), b = Math.min(box.b, r.bottom);
    return rr > l && b > tp ? { x: (l + rr) / 2, y: (tp + b) / 2 } : { x: (box.l + box.r) / 2, y: (box.t + box.b) / 2 };
  }

  // Страна, о которой спрашивают, целиком за краем карты — показываем весь мир
  function showTarget(code) {
    const r = svg.getBoundingClientRect();
    const visible = shapes[code].some((s) => {
      const b = s.getBoundingClientRect();
      return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
    });
    if (!visible) { view.k = 1; view.x = view.y = 0; applyView(); }
  }

  // На телефоне сами не ставим курсор в поле — экранная клавиатура закрыла бы карту
  const focusAnswer = () => { if (matchMedia("(pointer: fine)").matches) answerInput.focus(); };
  const shakeAnswer = () => {
    const form = $("answer");
    form.classList.remove("shake");
    void form.offsetWidth;
    form.classList.add("shake");
  };

  function submitAnswer(text) {
    if (!answerMode()) return;
    const code = matchCapital(text);
    if (code === undefined) return;
    closeAnswerList();
    const target = current();
    if (code === target) {
      const result = game.attempts + 1;
      game.results[target] = result;
      setClass(target, "s" + result, true);
      toast(t("right"));
      play("right");
      answerInput.value = "";
      const p = screenPoint(target);
      next();
      if (!game.over) {
        showCard(target, () => t("right") + " " + t("capitalOf").replace("{capital}", tr(byCode[target], "capital")), "right", p.x, p.y);
        focusAnswer();
      }
      return;
    }
    shakeAnswer();
    // Ни на одну столицу не похоже (опечатка, выдумка) — попыткой не считается
    if (!code) {
      hideCard();
      toast(t("noSuchCapital"));
      answerInput.select();
      return;
    }
    // Это столица другой страны — ошибка, показываем, чья она
    game.attempts++;
    play("wrong");
    const w = Math.floor(Math.random() * STR.ru.wrongAnswer.length);
    flash(code);
    const p = screenPoint(code);
    showCard(code, () => t("wrongAnswer")[w] + " " + t("capitalOf").replace("{capital}", tr(byCode[code], "capital")), "wrong", p.x, p.y);
    if (game.attempts >= 3) revealCapital();
    else answerInput.select();
  }

  // Три ошибки или «Не знаю»: показываем правильный ответ, страна становится красной
  function revealCapital() {
    const target = current();
    game.results[target] = 4;
    setClass(target, "s4", true);
    answerInput.value = "";
    closeAnswerList();
    const p = screenPoint(target);
    next();
    if (!game.over) {
      showCard(target, () => t("rememberCapital").replace("{capital}", tr(byCode[target], "capital")), "wrong", p.x, p.y);
      focusAnswer();
    }
  }

  // Выпадающий список столиц: открывается кнопкой ▾ (все) или стрелкой вниз (подходящие к написанному)
  let listItems = [], listActive = -1, listAll = false;
  const capitalNames = () => {
    const names = DATA.countries.filter((c) => c.capital).map((c) => tr(c, "capital"));
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, LOCALE[settings.lang]));
  };
  function openAnswerList(all) {
    const q = norm(answerInput.value);
    let names = capitalNames();
    if (!all) {
      if (!q) { closeAnswerList(); return; }
      // Сначала те, что начинаются с введённого, потом те, где оно в середине
      const starts = [], inside = [];
      for (const n of names) {
        const v = norm(n);
        if (v.startsWith(q)) starts.push(n);
        else if (v.includes(q)) inside.push(n);
      }
      names = [...starts, ...inside];
    }
    listItems = names;
    listAll = all;
    answerList.innerHTML = names.length
      ? names.map((n, i) => `<li role="option" id="answerOpt${i}" data-i="${i}">${escapeHtml(n)}</li>`).join("")
      : `<li class="empty">${escapeHtml(t("nothingFound"))}</li>`;
    answerList.hidden = false;
    answerList.scrollTop = 0;
    answerInput.setAttribute("aria-expanded", "true");
    $("answerToggle").setAttribute("aria-expanded", "true");
    // При вводе ничего не выделено: Enter отправляет написанное, а не первую подсказку
    setActive(all ? names.indexOf(answerInput.value) : -1, true);
  }
  function closeAnswerList() {
    answerList.hidden = true;
    answerInput.setAttribute("aria-expanded", "false");
    $("answerToggle").setAttribute("aria-expanded", "false");
    answerInput.removeAttribute("aria-activedescendant");
    listItems = [];
    listActive = -1;
    listAll = false;
  }
  function setActive(i, center) {
    answerList.querySelector(".active")?.classList.remove("active");
    listActive = i;
    const li = i >= 0 ? answerList.children[i] : null;
    if (!li) { answerInput.removeAttribute("aria-activedescendant"); return; }
    li.classList.add("active");
    answerInput.setAttribute("aria-activedescendant", li.id);
    if (center) answerList.scrollTop = li.offsetTop - (answerList.clientHeight - li.offsetHeight) / 2;
    else li.scrollIntoView({ block: "nearest" });
  }
  const pick = (i) => { answerInput.value = listItems[i]; submitAnswer(listItems[i]); };

  // Сам по себе список при вводе не открывается — чтобы вспоминали без подсказки.
  // Открытый кнопкой (или стрелкой) список при вводе сужается до подходящих столиц
  answerInput.addEventListener("input", () => { if (!answerList.hidden) openAnswerList(!norm(answerInput.value)); });
  answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !answerList.hidden) { e.preventDefault(); e.stopPropagation(); closeAnswerList(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (answerList.hidden) { openAnswerList(!norm(answerInput.value)); return; }
      if (!listItems.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(listActive < 0 ? (step > 0 ? 0 : listItems.length - 1) : (listActive + step + listItems.length) % listItems.length);
    } else if (e.key === "Enter" && !answerList.hidden && listActive >= 0) {
      e.preventDefault();
      pick(listActive);
    }
  });
  answerInput.addEventListener("blur", () => setTimeout(() => {
    if (!$("answer").contains(document.activeElement)) closeAnswerList();
  }, 150));
  // mousedown не уводит фокус из поля — иначе список закрылся бы раньше, чем сработает выбор
  answerList.addEventListener("mousedown", (e) => e.preventDefault());
  answerList.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) pick(+li.dataset.i);
  });
  $("answerToggle").addEventListener("mousedown", (e) => e.preventDefault());
  $("answerToggle").onclick = () => {
    // Открыт полный список — кнопка его закрывает, список найденного — заменяет полным
    if (!answerList.hidden && listAll) { closeAnswerList(); return; }
    openAnswerList(true);
    if (matchMedia("(pointer: fine)").matches) answerInput.focus();
  };
  $("answer").addEventListener("submit", (e) => { e.preventDefault(); submitAnswer(answerInput.value); });

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

  $("dunnoBtn").onclick = () => {
    if (game.over) return;
    if (answerMode()) { play("wrong"); revealCapital(); return; }
    if (!game.hinted) { play("wrong"); game.attempts = 3; giveHint(); }
  };
  $("enoughBtn").onclick = () => { if (!game.over) finish(); };
  // Окно новой игры, открытое поверх игры, можно закрыть без изменений (при первом запуске — нельзя)
  $("menuBtn").onclick = () => { hideCard(); $("startClose").hidden = false; $("startModal").hidden = false; };
  const closeStart = () => { if (!$("startClose").hidden) $("startModal").hidden = true; };
  $("startClose").onclick = closeStart;
  $("startBtn").onclick = () => {
    $("startModal").hidden = true;
    startGame(document.querySelector("input[name=mode]:checked").value);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || $("startModal").hidden || !$("settingsModal").hidden) return;
    if (e.target.closest("button, a")) return;
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
      if (box.dataset.field === "greyRings") applyView();
      else redrawCard();
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
    if (settings.greyRings) placeRingLabels();
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
  const closeSettings = () => { $("settingsModal").hidden = true; };
  $("settingsClose").onclick = $("settingsX").onclick = closeSettings;

  // Esc и клик по затемнённому фону закрывают верхнее окно
  const closers = { settingsModal: closeSettings, startModal: closeStart };
  for (const [id, close] of Object.entries(closers)) {
    const modal = $(id);
    let downOnBackdrop = false;
    modal.addEventListener("pointerdown", (e) => { downOnBackdrop = e.target === modal; });
    modal.addEventListener("click", (e) => { if (downOnBackdrop && e.target === modal) close(); });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const id = Object.keys(closers).find((id) => !$(id).hidden);
    if (id) { e.preventDefault(); closers[id](); }
  });

  applyLanguage();
  applyView();
})();
