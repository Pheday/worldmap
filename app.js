(function () {
  "use strict";

  const DATA = window.QUIZ_DATA;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const W = DATA.width, H = DATA.height;
  const MAX_ZOOM = 12;
  const DOT_RADIUS = 4.5;
  const DRAG_THRESHOLD = 6;

  const byCode = Object.fromEntries(DATA.countries.map((c) => [c.code, c]));
  const $ = (id) => document.getElementById(id);

  const MODES = {
    countries: { label: "Найдите", has: () => true, show: (c) => c.name },
    capitals: { label: "Чья столица", has: (c) => !!c.capital, show: (c) => c.capital },
    flags: { label: "Чей флаг", has: (c) => !!c.flag, show: (c) => `<img src="${c.flag}" alt="Флаг">` },
  };

  /* ---------- Настройки ---------- */

  const SETTINGS_KEY = "countries-quiz-settings";
  const settings = {
    flag: true, arms: false, capital: true, population: true, area: true, currency: true, language: true,
    sound: true,
  };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch (e) { /* без сохранения */ }

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
  viewport.appendChild(el("path", { d: DATA.other, class: "other" }));

  const shapes = {}; // code -> [path, dot?]
  const countryLayer = el("g"), dotLayer = el("g");
  viewport.append(countryLayer, dotLayer);
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
    // Кружки мелких стран не раздуваются при приближении
    const r = DOT_RADIUS / Math.sqrt(view.k);
    for (const dot of dotLayer.children) dot.setAttribute("r", r);
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
      press = { code: e.target.dataset.code || null, x: e.clientX, y: e.clientY, moved: false };
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
      else hideCard();
    }
    if (pointers.size === 0) press = null;
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("pointerleave", hideTooltip);

  /* ---------- Подсказка с названием (только для отгаданных) ---------- */

  const tooltip = $("tooltip");
  let hovered = null;

  function hover(e) {
    const code = e.target.dataset.code || null;
    if (code !== hovered) {
      if (hovered) setClass(hovered, "hover", false);
      if (code) setClass(code, "hover", true);
      hovered = code;
    }
    if (code && (game.over || game.results[code])) {
      const r = $("mapWrap").getBoundingClientRect();
      tooltip.textContent = byCode[code].name;
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
  }

  /* ---------- Карточка страны ---------- */

  const card = $("card");
  const fmt = (n) => n.toLocaleString("ru-RU");

  let cardState = null; // что сейчас в карточке — чтобы перерисовать при смене настроек

  function showCard(code, verdict, verdictClass, clientX, clientY) {
    cardState = { code, verdict, verdictClass, clientX, clientY };
    const c = byCode[code];
    $("cardVerdict").textContent = verdict || "";
    $("cardVerdict").className = "card-verdict " + (verdictClass || "");
    $("cardName").textContent = c.name;

    setImage("cardFlag", c.flag, "Флага нет");
    setImage("cardArms", c.arms, "Официального герба нет");
    $("cardArmsCaption").textContent = c.armsIsEmblem ? "Эмблема" : "Герб";
    $("cardFlag").parentElement.hidden = !settings.flag;
    $("cardArms").parentElement.hidden = !settings.arms;
    document.querySelector(".card-images").hidden = !settings.flag && !settings.arms;

    const facts = [
      ["capital", "Столица", c.capital || "нет"],
      ["population", "Население", c.population ? `${fmt(c.population)} <small>(${c.populationYear})</small>` : "нет постоянного населения"],
      ["area", "Площадь", c.area ? `${fmt(c.area)} км²` : "—"],
      ["currency", c.currency.length > 1 ? "Валюты" : "Валюта", c.currency.join(", ") || "—"],
      ["language", c.language.length > 1 ? "Языки" : "Язык", c.language.join(", ") || "—"],
    ].filter(([field]) => settings[field]);
    $("cardFacts").innerHTML = facts.map(([, k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

    card.hidden = false;
    placeCard(clientX, clientY);
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

  function placeCard(x, y) {
    if (window.matchMedia("(max-width: 640px)").matches) return; // на телефоне — снизу, через CSS
    const gap = 18, margin = 12;
    const w = card.offsetWidth, h = card.offsetHeight;
    let left = x + gap, top = y - h / 3;
    if (left + w > innerWidth - margin) left = x - gap - w;
    left = Math.max(margin, Math.min(left, innerWidth - w - margin));
    top = Math.max(margin, Math.min(top, innerHeight - h - margin));
    card.style.left = left + "px";
    card.style.top = top + "px";
  }

  function hideCard() { card.hidden = true; cardState = null; }
  $("cardClose").onclick = hideCard;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCard(); });

  /* ---------- Игра ---------- */

  const game = { mode: "countries", queue: [], index: 0, attempts: 0, hinted: false, results: {}, over: true, started: 0, timer: 0 };
  const WRONG = ["Мимо!", "Не тут!", "Не-а!", "Не здесь!", "Нет!"];

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
    $("questionLabel").textContent = mode.label;
    $("questionValue").innerHTML = mode.show(byCode[current()]);
    $("progress").textContent = `${game.index} из ${game.queue.length}`;
  }

  function updateTimer() {
    const s = Math.floor((Date.now() - game.started) / 1000);
    $("timer").textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  function onCountryClick(code, x, y) {
    if (game.over) { showCard(code, "", "", x, y); return; }

    if (game.results[code]) { showCard(code, "Уже отгадано", "known", x, y); return; }

    const target = current();
    if (code === target) {
      const result = game.hinted ? 4 : game.attempts + 1;
      game.results[code] = result;
      setClass(code, "hint", false);
      setClass(code, "s" + result, true);
      const verdict = result === 4 ? "Запомните!" : "Верно!";
      showCard(code, verdict + " Это", "right", x, y);
      toast(verdict);
      play("right");
      next();
      return;
    }

    game.attempts++;
    play("wrong");
    flash(code);
    showCard(code, WRONG[Math.floor(Math.random() * WRONG.length)] + " Это", "wrong", x, y);
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
    $("progress").textContent = `${Object.keys(game.results).length} из ${game.queue.length}`;

    const counts = [0, 0, 0, 0, 0];
    for (const r of Object.values(game.results)) counts[r]++;
    const total = game.queue.length;
    const skipped = total - Object.keys(game.results).length;
    const score = Math.round(((counts[1] * 3 + counts[2] * 2 + counts[3]) / (total * 3)) * 100);
    const mode = { countries: "страны", capitals: "столицы", flags: "флаги" }[game.mode];
    const verdict = score === 100 ? "Идеально!" : score >= 85 ? `Вы отлично знаете ${mode}` : score >= 65 ? `Вы хорошо знаете ${mode}`
      : score >= 40 ? `Вы более-менее знаете ${mode}` : `Есть куда расти`;

    $("endTitle").textContent = verdict;
    $("endScore").textContent = score + "%";
    const rows = [
      ["var(--first)", "С первой попытки", counts[1]],
      ["var(--second)", "Со второй", counts[2]],
      ["var(--third)", "С третьей", counts[3]],
      ["var(--failed)", "Не отгадано", counts[4]],
    ];
    if (skipped) rows.push(["var(--land)", "Не дошли", skipped]);
    rows.push(["transparent", "Время", $("timer").textContent]);
    $("endStats").innerHTML = rows.map(([color, label, n]) => `<li><i style="background:${color}"></i>${label}</li><li><b>${n}</b></li>`).join("");
    $("endModal").hidden = false;
    play(score >= 65 ? "win" : "lose");
  }

  /* ---------- Кнопки ---------- */

  $("dunnoBtn").onclick = () => { if (!game.over && !game.hinted) { play("wrong"); game.attempts = 3; giveHint(); } };
  $("enoughBtn").onclick = () => { if (!game.over) finish(); };
  $("menuBtn").onclick = () => { hideCard(); $("startModal").hidden = false; };
  $("startBtn").onclick = () => {
    $("startModal").hidden = true;
    startGame(document.querySelector("input[name=mode]:checked").value);
  };
  $("againBtn").onclick = () => { $("endModal").hidden = true; startGame(game.mode); };
  $("inspectBtn").onclick = () => { $("endModal").hidden = true; };

  function renderSoundButton() {
    $("soundBtn").textContent = settings.sound ? "🔊" : "🔇";
    $("soundBtn").title = settings.sound ? "Звук включён" : "Звук выключен";
    $("soundOption").checked = settings.sound;
  }
  $("soundBtn").onclick = () => { settings.sound = !settings.sound; saveSettings(); renderSoundButton(); };
  $("soundOption").onchange = (e) => { settings.sound = e.target.checked; saveSettings(); renderSoundButton(); };

  for (const box of document.querySelectorAll("#cardOptions input")) {
    box.checked = settings[box.dataset.field];
    box.onchange = () => {
      settings[box.dataset.field] = box.checked;
      saveSettings();
      if (cardState) {
        const s = cardState;
        showCard(s.code, s.verdict, s.verdictClass, s.clientX, s.clientY);
      }
    };
  }
  const openSettings = () => { $("settingsModal").hidden = false; };
  $("settingsBtn").onclick = openSettings;
  $("startSettingsBtn").onclick = openSettings;
  $("settingsClose").onclick = () => { $("settingsModal").hidden = true; };

  renderSoundButton();
  applyView();
})();
