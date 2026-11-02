// Строит иконку вкладки ../favicon.svg — упрощённая карта мира в проекции Робинсона.
// Цвета из style.css: фон — чуть светлее --accent, суша — --land. Мелкие детали убраны, чтобы читалось в 16 px.
import fs from "fs";
import mapshaper from "mapshaper";
import { geoRobinson } from "d3-geo-projection";

const SIZE = 64;
const PAD = 3;
const RADIUS = 12;
const COLORS = { ocean: "#5094d8", land: "#f3ecd9" };

const src = fs.readFileSync("cache/ne_10m_admin_0_countries_rus.geojson", "utf8");
const out = await mapshaper.applyCommands(
  "-i in.json -filter 'ADM0_A3_RU != \"ATA\"' -dissolve -filter-islands min-area=500000km2 " +
  "-simplify 0.15% keep-shapes -o out.json format=geojson precision=0.01",
  { "in.json": src }
);
const land = JSON.parse(out["out.json"]);
const geometries = land.features ? land.features.map((f) => f.geometry) : land.geometries;

// Проецируем точки напрямую (см. build-map.mjs), потом вписываем рамку суши в квадрат.
const projection = geoRobinson().scale(1).translate([0, 0]);
const rings = [];
for (const g of geometries) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const ring of poly) rings.push(ring.map((c) => projection(c)));
}
const xs = rings.flat().map((p) => p[0]);
const ys = rings.flat().map((p) => p[1]);
const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
const k = (SIZE - 2 * PAD) / (x1 - x0);
const dy = (SIZE - (y1 - y0) * k) / 2;
const r1 = (v) => Math.round(v * 10) / 10;

let landPath = "";
for (const ring of rings) {
  const pts = [];
  for (const [x, y] of ring) {
    const p = [r1(PAD + (x - x0) * k), r1(dy + (y - y0) * k)];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  if (pts.length >= 4) landPath += "M" + pts.map((p) => p.join(",")).join("L") + "Z";
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${COLORS.ocean}"/>
  <path fill="${COLORS.land}" fill-rule="evenodd" d="${landPath}"/>
</svg>
`;
fs.writeFileSync("../favicon.svg", svg);
console.log(`favicon.svg: ${svg.length} байт`);
