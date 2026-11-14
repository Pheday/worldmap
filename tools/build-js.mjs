// Собирает data/data.js для страницы: контуры + сведения о странах.
// Данные лежат в JS, а не в JSON, чтобы index.html открывался прямо с диска (file://).
import fs from "fs";
import { makeProjection } from "./projection.mjs";
import { TERRITORIES } from "./territories.mjs";

const { projection } = makeProjection();
const r1 = (v) => Math.round(v * 10) / 10;

const map = JSON.parse(fs.readFileSync("cache/map.json", "utf8"));
const info = JSON.parse(fs.readFileSync("cache/countries.json", "utf8"));
const wb = JSON.parse(fs.readFileSync("cache/worldbank.json", "utf8"));

const countries = map.countries.map(({ code, d, dot }) => {
  const c = info[code];
  return {
    code, d, dot,
    // Тексты на трёх языках: { ru, en, zh }
    name: { ru: c.name, en: c.en.name, zh: c.zh.name },
    capital: c.capital ? { ru: c.capital, en: c.en.capital, zh: c.zh.capital } : null,
    capitalXY: c.capitalCoord ? projection(c.capitalCoord).map(r1) : null,
    population: c.population, populationYear: c.populationYear, area: c.area, gdp: c.gdp, gdpYear: c.gdpYear,
    currency: { ru: c.currency, en: c.en.currency, zh: c.zh.currency },
    language: { ru: c.language, en: c.en.language, zh: c.zh.language },
    flag: fs.existsSync(`../data/flags/${code}.png`) ? `data/flags/${code}.png` : null,
    arms: fs.existsSync(`../data/arms/${code}.png`) ? `data/arms/${code}.png` : null,
    armsIsEmblem: c.armsIsEmblem,
  };
});

// Территории, по которым трудно попасть даже при максимальном приближении (×150 — меньше ~300 px²
// или полоска вроде острова Ханс), получают кружок, как мелкие страны
const TINY_AREA = 0.013;
function tinyDot(d) {
  const rings = d.split("Z").filter(Boolean).map((r) => r.slice(1).split("L").map((p) => p.split(",").map(Number)));
  let area = 0;
  const xs = [], ys = [];
  for (const r of rings) {
    let s = 0;
    r.forEach(([x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; s += x * y2 - x2 * y; xs.push(x); ys.push(y); });
    area += Math.abs(s / 2);
  }
  if (area >= TINY_AREA) return undefined;
  return [r1((Math.min(...xs) + Math.max(...xs)) / 2), r1((Math.min(...ys) + Math.max(...ys)) / 2)];
}

// Особые территории: контур + название + статус (см. territories.mjs)
const codes = new Set(countries.map((c) => c.code));
const other = map.other.map(({ code, name, d }) => {
  const t = TERRITORIES[code];
  if (!t) throw new Error(`нет описания особой территории ${code} в territories.mjs`);
  for (const k of ["owner", "control", "claim", "neither"]) for (const c of t[k] || []) if (!codes.has(c)) throw new Error(`${code}.${k}: нет страны ${c}`);
  const n = { ...name, ...t.name };
  if (!n.ru || !n.en || !n.zh) throw new Error(`нет названия территории ${code}`);
  n.ru = n.ru.charAt(0).toUpperCase() + n.ru.slice(1); // «остров Мэн» у Natural Earth → «Остров Мэн»
  if (!t.wiki) throw new Error(`нет статьи Рувики для территории ${code}`);
  return { code, d, dot: tinyDot(d), name: n, kind: t.kind, owner: t.owner, control: t.control, claim: t.claim, neither: t.neither, wiki: t.wiki, wikiSearch: t.wikiSearch };
});
// Силуэт для обводки: особые территории (настройка «Отмечать территории с особым статусом») и островные государства,
// чьи острова разбросаны по океану (у них обводка вместо кружка на одном острове).
// Силуэт — одна выпуклая оболочка всех островов, без перемычек между далёкими частями. app.js раздувает её
// на постоянное число пикселей экрана, так что обводка — плавная выпуклая фигура при любом масштабе
// (заливы и фьорды внутри неё не важны).
// Если острова лежат по обе стороны линии перемены дат (Кирибати, Фиджи), острова с западного края карты
// сдвигаются на 360° долготы к восточному, оболочка строится по всем сразу и рисуется дважды — у восточного
// края и её копия у западного; app.js обрезает их по краю карты, так что фигура уходит за край и выходит с другого
const rings = (d) => d.split("Z").filter(Boolean).map((r) => r.slice(1).split("L").map((p) => p.split(",").map(Number)));
function hull(points) { // выпуклая оболочка, монотонная цепочка Эндрю
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const q of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}
const f3 = (v) => Math.round(v * 1000) / 1000;
const cx = projection.translate()[0];
// На сколько сдвигается x при повороте на 360° долготы на высоте y: в проекции Робинсона x линеен по долготе
const turn = (y) => 2 * (projection([180, projection.invert([cx, y])[1]])[0] - cx);
// Мелкие острова после округления координат — отрезок или треугольник из 2–3 точек, и при сильном
// приближении обводка вокруг них выходит капсулой или угловатой. Для них силуэт — описанный круг,
// настоящий: в пути SVG это две дуги (A), а не многоугольник
const SMALL = 2; // единиц карты
function outline(d) {
  const pts = rings(d).flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (Math.max(x1 - x0, y1 - y0) < SMALL) {
    const r = f3(Math.max(0.05, Math.hypot(x1 - x0, y1 - y0) / 2)), cy = f3((y0 + y1) / 2), a = `A${r},${r} 0 1 0 `;
    const l = f3((x0 + x1) / 2 - r), rt = f3((x0 + x1) / 2 + r);
    return `M${l},${cy}${a}${rt},${cy}${a}${l},${cy}Z`;
  }
  const wrap = x1 - x0 > map.width / 2;
  const h = hull(wrap ? pts.map(([x, y]) => [x < cx ? f3(x + turn(y)) : x, y]) : pts);
  const path = (shift) => "M" + h.map(([x, y]) => [f3(x + shift(y)), y].join(",")).join("L") + "Z";
  return path(() => 0) + (wrap ? path((y) => -turn(y)) : "");
}
for (const o of other) if (o.code !== "ATA") o.outline = outline(o.d);

const ARCHIPELAGOS = new Set(["BHS", "SYC", "KIR", "MHL", "MUS", "COM", "STP", "CPV", "TON", "WSM", "SLB", "TUV", "MDV", "FSM", "VUT", "PLW", "TTO", "ATG", "VCT", "FJI"]);
for (const c of countries) {
  if (!ARCHIPELAGOS.has(c.code)) continue;
  if (!c.dot) throw new Error(`${c.code} в ARCHIPELAGOS, но это не страна-кружок`);
  c.outline = outline(c.d);
}

for (const code of Object.keys(TERRITORIES)) if (!other.some((o) => o.code === code)) console.log("в territories.mjs лишняя запись:", code);

const areaYear = Math.max(...wb.area.map((r) => r.year).filter((y, _, all) => all.filter((x) => x === y).length > 250));
// Год ВВП, за который есть данные по большинству стран; у остальных год показывается в карточке
const gdpYears = countries.map((c) => c.gdpYear).filter(Boolean);
const gdpYear = Math.max(...gdpYears.filter((y) => gdpYears.filter((x) => x === y).length > countries.length / 2));
// Линейка масштаба: в проекции Робинсона масштаб зависит от широты.
// Для каждого градуса широты — y на карте и сколько км по параллели приходится на 1 единицу карты.
const KM_PER_DEGREE = (Math.PI * 6371) / 180;
const scaleBar = [];
for (let lat = 89; lat >= -89; lat--) {
  const [x0, y] = projection([0, lat]), [x1] = projection([1, lat]);
  scaleBar.push([r1(y), Math.round((KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180)) / (x1 - x0) * 1000) / 1000]);
}
const data = { width: map.width, height: map.height, sphere: map.sphere, other, areaYear, gdpYear, scaleBar, countries };
fs.writeFileSync("../data/data.js", "window.QUIZ_DATA = " + JSON.stringify(data) + ";\n");
console.log("data.js KB:", Math.round(fs.statSync("../data/data.js").size / 1024),
  "без флага:", countries.filter((c) => !c.flag).map((c) => c.code).join(" ") || "—",
  "без герба:", countries.filter((c) => !c.arms).map((c) => c.code).join(" ") || "—");
