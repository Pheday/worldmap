// Строит контуры стран для карты из Natural Earth 1:10m (вариант «с точки зрения России»).
// Результат: tools/cache/map.json — SVG-пути в проекции Робинсона.
//
// Помимо варианта Natural Earth карта приведена к конституции России: ДНР, ЛНР,
// Запорожская и Херсонская области — в составе России (в границах областей).
// Границы областей берутся из Natural Earth 1:10m admin-1 (см. fetch-admin1.mjs).
import fs from "fs";
import mapshaper from "mapshaper";
import { geoPath } from "d3-geo";
import { WIDTH, makeProjection } from "./projection.mjs";

const SMALL_AREA = 40; // px² — страны меньше этого получают кружок-маркер
// Острова, разбросанные мелкими кусками: площадь больше порога, но попасть мышью трудно
const FORCE_DOT = new Set(["SLB"]);

// Куски, которые присоединяем к другим странам
const MERGE = {
  HKG: "CHN", MAC: "CHN",   // Гонконг, Макао
  ESB: "CYP", WSB: "CYP",   // британские базы на Кипре
  C02: "RUS", C03: "RUS",   // районы Донецкой и Луганской областей, которые Natural Earth отдаёт Украине отдельными кусками
  B38: "AZE",               // Нагорный Карабах
};
// Страны, которые Natural Earth помечает не как «Sovereign country»
const EXTRA = new Set(["PSX", "SAH", "B35", "B37", "VAT", "ISR", "KAZ", "CUB"]);
// Помечены как «Country», но это зависимые территории; Антарктида — не государство
const NOT_COUNTRIES = new Set(["SXM", "GRL", "CUW", "ABW", "JEY", "GGY", "IMN", "ALD", "ATA"]);

// Субъекты России по конституции: ISO-коды областей в Natural Earth admin-1
const CLAIMS = new Set(["UA-09", "UA-14", "UA-23", "UA-65"]); // ЛНР, ДНР, Запорожская, Херсонская

const fc = (geoms) => ({ type: "FeatureCollection", features: geoms.map((g) => ({ type: "Feature", properties: {}, geometry: g })) });
const shp = async (commands, files) => {
  const out = await mapshaper.applyCommands(commands, files);
  return JSON.parse(out["out.json"].toString());
};
// mapshaper после clip/erase отдаёт геометрию без атрибутов — приводим её к MultiPolygon
const asPolys = (geo) => {
  if (!geo) return [];
  switch (geo.type) {
    case "Polygon": return [geo.coordinates];
    case "MultiPolygon": return geo.coordinates;
    case "GeometryCollection": return geo.geometries.flatMap(asPolys);
    case "FeatureCollection": return geo.features.flatMap((f) => asPolys(f.geometry));
    case "Feature": return asPolys(geo.geometry);
    default: return [];
  }
};
const multi = (geo) => ({ type: "MultiPolygon", coordinates: asPolys(geo) });

const src = JSON.parse(fs.readFileSync("cache/ne_10m_admin_0_countries_rus.geojson", "utf8"));

// --- Перенос четырёх областей из Украины в Россию -------------------------
// Области вырезаем из контура Украины и добавляем России в тех же очертаниях,
// обрезанных по контуру Украины, — так на стыке не остаётся щелей и наложений.
const byCode = (c) => src.features.find((f) => f.properties.ADM0_A3_RU === c);
const ukr = byCode("UKR");
const adm1 = JSON.parse(fs.readFileSync("cache/ne_10m_admin_1_states_provinces.geojson", "utf8"));
const claim = adm1.features.filter((f) => CLAIMS.has(f.properties.iso_3166_2)).map((f) => f.geometry);
if (claim.length !== CLAIMS.size) throw new Error(`admin-1: найдено ${claim.length} из ${CLAIMS.size} областей`);

const oldUkr = ukr.geometry;
const land = multi(await shp("-i in.json -dissolve2 k -o out.json format=geojson", {
  "in.json": JSON.stringify({ type: "FeatureCollection", features: [oldUkr, byCode("C02").geometry, byCode("C03").geometry].map((g) => ({ type: "Feature", properties: { k: "land" }, geometry: g })) }),
}));
const four = multi(await shp("-i claim.json -clip land.json -o out.json format=geojson", {
  "claim.json": JSON.stringify(fc(claim)), "land.json": JSON.stringify(land),
}));
const cut = multi(await shp("-i ukr.json -erase claim.json -o out.json format=geojson", {
  "ukr.json": JSON.stringify(fc([oldUkr])), "claim.json": JSON.stringify(fc(claim)),
}));
ukr.geometry = cut;
if (!cut.coordinates.length) throw new Error("Украина исчезла после вырезания областей");
src.features.push({ type: "Feature", properties: { ADM0_A3_RU: "RUS", TYPE: "Sovereign country" }, geometry: four });
console.log("области перенесены в Россию: кусков", four.coordinates.length, "| у Украины осталось кусков", cut.coordinates.length);

const labels = {}, names = {};
for (const f of src.features) {
  const p = f.properties;
  const code = MERGE[p.ADM0_A3_RU] || p.ADM0_A3_RU;
  const isCountry = !!MERGE[p.ADM0_A3_RU] || !NOT_COUNTRIES.has(code) &&
    (EXTRA.has(code) || p.TYPE === "Sovereign country" || p.TYPE === "Country");
  p.key = isCountry ? code : "x_" + code;
  if (!MERGE[p.ADM0_A3_RU] && p.LABEL_X != null) labels[code] = { lon: p.LABEL_X, lat: p.LABEL_Y, qid: p.WIKIDATAID };
  if (!isCountry && p.NAME_RU) names[code] = { ru: p.NAME_RU, en: p.NAME_EN, zh: p.NAME_ZH };
  for (const k of Object.keys(p)) if (k !== "key") delete p[k];
}

const out = await mapshaper.applyCommands(
  // explode: keep-shapes бережёт каждый остров, а не только самый большой кусок страны (иначе пропадает, например, Принсипи)
  "-i in.json -dissolve key -explode -simplify 6% keep-shapes planar -dissolve key -clean -o out.json format=geojson precision=0.001",
  { "in.json": JSON.stringify(src) }
);
const geo = JSON.parse(out["out.json"]);

const { projection, height } = makeProjection();
const path = geoPath(projection);

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

// Кружок ставим в точку подписи Natural Earth, но если она в море между островами
// (а главный остров недалеко) — на главный остров
const inRing = ([x, y], pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const DOT_SNAP = 6; // единиц карты — дальше не переносим (архипелаги вроде Кирибати)
function dotPosition(p, rings) {
  if (rings.some((r) => inRing(p, r.pts))) return p.map(r1);
  const main = rings.reduce((a, b) => (b.area > a.area ? b : a)).pts;
  const c = [0, 1].map((i) => main.reduce((s, q) => s + q[i], 0) / main.length);
  return (Math.hypot(c[0] - p[0], c[1] - p[1]) <= DOT_SNAP ? c : p).map(r1);
}

const countries = [], other = [];
for (const f of geo.features) {
  if (!f.geometry) continue;
  const key = f.properties.key;
  const rings = projectRings(f.geometry);
  const total = rings.reduce((s, r) => s + r.area, 0);
  const biggest = rings.reduce((a, b) => (b.area > a.area ? b : a));
  // Кольца, схлопнувшиеся после округления, выбрасываем — но у страны остаётся хотя бы одно
  // (у стран-кружков оставляем все острова: при приближении их видно)
  const small = !key.startsWith("x_") && (total < SMALL_AREA || FORCE_DOT.has(key));
  const kept = rings.filter((r) => r === biggest || (r.pts.length >= 3 && (small || r.area >= 0.05)));
  // Серые территории — каждая отдельно, чтобы по клику показать, что это
  if (key.startsWith("x_")) { other.push({ code: key.slice(2), name: names[key.slice(2)], d: toPath(kept) }); continue; }
  const l = labels[key];
  const c = { code: key, qid: l?.qid, d: toPath(kept) };
  if (small) c.dot = dotPosition(l ? projection([l.lon, l.lat]) : biggest.pts[0], kept);
  countries.push(c);
}

const sphere = round(path({ type: "Sphere" }));
fs.writeFileSync("cache/map.json", JSON.stringify({ width: WIDTH, height, sphere, other, countries }));
console.log("countries:", countries.length, "small:", countries.filter((c) => c.dot).length,
  "size KB:", Math.round(fs.statSync("cache/map.json").size / 1024));
