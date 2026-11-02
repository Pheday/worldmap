// Строит контуры стран для карты из Natural Earth 1:10m (вариант «с точки зрения России»).
// Результат: tools/cache/map.json — SVG-пути в проекции Робинсона.
import fs from "fs";
import mapshaper from "mapshaper";
import { geoPath } from "d3-geo";
import { geoRobinson } from "d3-geo-projection";

const WIDTH = 1600;
const SMALL_AREA = 40; // px² — страны меньше этого получают кружок-маркер

// Куски, которые присоединяем к другим странам
const MERGE = {
  HKG: "CHN", MAC: "CHN",   // Гонконг, Макао
  ESB: "CYP", WSB: "CYP",   // британские базы на Кипре
  C02: "UKR", C03: "UKR",   // Донецкая и Луганская области
  B38: "AZE",               // Нагорный Карабах
};
// Страны, которые Natural Earth помечает не как «Sovereign country»
const EXTRA = new Set(["PSX", "SAH", "B35", "B37", "VAT", "ATA", "ISR", "KAZ", "CUB"]);
// Помечены как «Country», но это зависимые территории
const NOT_COUNTRIES = new Set(["SXM", "GRL", "CUW", "ABW", "JEY", "GGY", "IMN", "ALD"]);

const src = JSON.parse(fs.readFileSync("cache/ne_10m_admin_0_countries_rus.geojson", "utf8"));
const labels = {};
for (const f of src.features) {
  const p = f.properties;
  const code = MERGE[p.ADM0_A3_RU] || p.ADM0_A3_RU;
  const isCountry = !NOT_COUNTRIES.has(code) &&
    (EXTRA.has(code) || p.TYPE === "Sovereign country" || p.TYPE === "Country");
  p.key = isCountry ? code : "x_" + code;
  if (!MERGE[p.ADM0_A3_RU] && p.LABEL_X != null) labels[code] = { lon: p.LABEL_X, lat: p.LABEL_Y, qid: p.WIKIDATAID };
  for (const k of Object.keys(p)) if (k !== "key") delete p[k];
}

const out = await mapshaper.applyCommands(
  "-i in.json -dissolve key -simplify 6% keep-shapes planar -clean -o out.json format=geojson precision=0.001",
  { "in.json": JSON.stringify(src) }
);
const geo = JSON.parse(out["out.json"]);

const projection = geoRobinson().fitWidth(WIDTH, { type: "Sphere" });
const path = geoPath(projection);
const [[, y0], [, y1]] = path.bounds({ type: "Sphere" });
const height = Math.ceil(y1 - y0);
projection.translate([projection.translate()[0], projection.translate()[1] - y0]);

const round = (s) => s.replace(/\d+\.\d+/g, (n) => (+n).toFixed(1));
const r1 = (v) => Math.round(v * 10) / 10;

// Проецируем точки напрямую, без сферической геометрии d3: у крошечных полигонов
// она путает направление обхода и рисует «весь мир минус страна».
function projectRings(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const rings = [];
  for (const poly of polys) for (const ring of poly) {
    const pts = [];
    for (const c of ring) {
      const [x, y] = projection(c).map(r1);
      const last = pts[pts.length - 1];
      if (!last || last[0] !== x || last[1] !== y) pts.push([x, y]);
    }
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      area += ax * by - bx * ay;
    }
    rings.push({ pts, area: Math.abs(area / 2) });
  }
  return rings;
}

const toPath = (rings) => rings.map((r) => "M" + r.pts.map((p) => p.join(",")).join("L") + "Z").join("");

const countries = [], other = [];
for (const f of geo.features) {
  if (!f.geometry) continue;
  const key = f.properties.key;
  const rings = projectRings(f.geometry);
  const total = rings.reduce((s, r) => s + r.area, 0);
  const biggest = rings.reduce((a, b) => (b.area > a.area ? b : a));
  // Кольца, схлопнувшиеся после округления, выбрасываем — но у страны остаётся хотя бы одно
  const kept = rings.filter((r) => r === biggest || (r.pts.length >= 3 && r.area >= 0.05));
  if (key.startsWith("x_")) { other.push(toPath(kept)); continue; }
  const l = labels[key];
  const c = { code: key, qid: l?.qid, d: toPath(kept) };
  if (total < SMALL_AREA) {
    const [x, y] = l ? projection([l.lon, l.lat]) : biggest.pts[0];
    c.dot = [r1(x), r1(y)];
  }
  countries.push(c);
}

const sphere = round(path({ type: "Sphere" }));
fs.writeFileSync("cache/map.json", JSON.stringify({ width: WIDTH, height, sphere, other: other.join(""), countries }));
console.log("countries:", countries.length, "small:", countries.filter((c) => c.dot).length,
  "size KB:", Math.round(fs.statSync("cache/map.json").size / 1024));
