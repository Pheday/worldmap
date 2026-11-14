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

// Серые территории: контур + название + статус (см. territories.mjs)
const codes = new Set(countries.map((c) => c.code));
const other = map.other.map(({ code, name, d }) => {
  const t = TERRITORIES[code];
  if (!t) throw new Error(`нет описания серой территории ${code} в territories.mjs`);
  for (const k of ["owner", "control", "claim", "neither"]) for (const c of t[k] || []) if (!codes.has(c)) throw new Error(`${code}.${k}: нет страны ${c}`);
  const n = { ...name, ...t.name };
  if (!n.ru || !n.en || !n.zh) throw new Error(`нет названия территории ${code}`);
  if (!t.wiki) throw new Error(`нет статьи Рувики для территории ${code}`);
  return { code, d, dot: tinyDot(d), name: n, kind: t.kind, owner: t.owner, control: t.control, claim: t.claim, neither: t.neither, wiki: t.wiki, wikiSearch: t.wikiSearch };
});
// Силуэт каждой серой территории для обводки (настройка «Обводить серые территории»):
// острова одной территории, лежащие ближе CLUSTER_GAP друг к другу, объединяются в группу,
// группа — выпуклая оболочка. app.js раздувает её на постоянное число пикселей экрана, так что
// обводка — плавная выпуклая фигура вокруг территории при любом масштабе (заливы и фьорды
// внутри неё не важны), а далёкие группы одной территории связывает «перемычками».
const CLUSTER_GAP = 4; // единиц карты
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
for (const o of other) {
  if (o.code === "ATA") continue;
  const parts = rings(o.d).map((pts) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { pts, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  const gap = (a, b) => Math.max(a.box[0] - b.box[2], b.box[0] - a.box[2], a.box[1] - b.box[3], b.box[1] - a.box[3]);
  const groups = parts.map((q) => [q]);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++) for (let j = i + 1; j < groups.length && !merged; j++) {
      if (groups[i].some((a) => groups[j].some((b) => gap(a, b) < CLUSTER_GAP))) {
        groups[i].push(...groups.splice(j, 1)[0]);
        merged = true;
      }
    }
  }
  o.outline = groups.map((g) => "M" + hull(g.flatMap((q) => q.pts)).map((p) => p.join(",")).join("L") + "Z").join("");
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
