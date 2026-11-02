// Скачивает границы областей (Natural Earth 1:10m admin-1) в кэш.
import fs from "fs";

const URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";
const OUT = "cache/ne_10m_admin_1_states_provinces.geojson";
if (!fs.existsSync(OUT)) {
  const r = await fetch(URL);
  if (!r.ok) throw new Error("HTTP " + r.status);
  fs.writeFileSync(OUT, await r.text());
}
console.log("готово:", OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + " МБ");
