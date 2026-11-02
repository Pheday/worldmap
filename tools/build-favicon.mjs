// Строит иконку вкладки ../favicon.svg — карта мира в той же проекции и цветах, что и на странице.
import fs from "fs";
import mapshaper from "mapshaper";
import { geoPath } from "d3-geo";
import { geoRobinson } from "d3-geo-projection";

const SIZE = 64;
const PAD = 1;
const COLORS = { ocean: "#cfe3ef", land: "#f3ecd9", border: "#9b8f73" }; // как в style.css

const src = fs.readFileSync("cache/ne_10m_admin_0_countries_rus.geojson", "utf8");
const out = await mapshaper.applyCommands(
  "-i in.json -dissolve -filter-islands min-area=200000km2 -simplify 0.3% keep-shapes -o out.json format=geojson precision=0.01",
  { "in.json": src }
);
const land = JSON.parse(out["out.json"]);

const sphere = { type: "Sphere" };
const projection = geoRobinson().fitExtent([[PAD, PAD], [SIZE - PAD, SIZE - PAD]], sphere);
const path = geoPath(projection);
const [[, y0], [, y1]] = path.bounds(sphere);
const dy = (SIZE - (y1 - y0)) / 2 - y0; // по центру по вертикали
projection.translate([projection.translate()[0], projection.translate()[1] + dy]);

const r1 = (v) => Math.round(v * 10) / 10;

// Проецируем точки напрямую, как в build-map.mjs: сферическая геометрия d3
// путает направление обхода и рисует «весь мир минус суша».
let landPath = "";
const geometries = land.features ? land.features.map((f) => f.geometry) : land.geometries;
for (const g of geometries) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const ring of poly) {
    const pts = [];
    for (const c of ring) {
      const [x, y] = projection(c).map(r1);
      const last = pts[pts.length - 1];
      if (!last || last[0] !== x || last[1] !== y) pts.push([x, y]);
    }
    if (pts.length >= 4) landPath += "M" + pts.map((p) => p.join(",")).join("L") + "Z";
  }
}

// Контур сферы строим по точкам сами: d3 рисует его слишком угловатым для такого размера.
const outline = [];
for (let lat = -90; lat <= 90; lat += 2) outline.push(projection([180, lat]));
for (let lat = 90; lat >= -90; lat -= 2) outline.push(projection([-180, lat]));
const spherePath = "M" + outline.map((p) => p.map(r1).join(",")).join("L") + "Z";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <path fill="${COLORS.ocean}" stroke="${COLORS.border}" stroke-width="1" stroke-linejoin="round" d="${spherePath}"/>
  <path fill="${COLORS.land}" stroke="${COLORS.border}" stroke-width="0.6" stroke-linejoin="round" fill-rule="evenodd" d="${landPath}"/>
</svg>
`;
fs.writeFileSync("../favicon.svg", svg);
console.log(`favicon.svg: ${svg.length} байт`);
