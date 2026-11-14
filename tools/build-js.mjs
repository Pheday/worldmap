// Собирает data/data.js для страницы: контуры + сведения о странах.
// Данные лежат в JS, а не в JSON, чтобы index.html открывался прямо с диска (file://).
import fs from "fs";
import { makeProjection } from "./projection.mjs";

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

const areaYear = Math.max(...wb.area.map((r) => r.year).filter((y, _, all) => all.filter((x) => x === y).length > 250));
// Год ВВП, за который есть данные по большинству стран; у остальных год показывается в карточке
const gdpYears = countries.map((c) => c.gdpYear).filter(Boolean);
const gdpYear = Math.max(...gdpYears.filter((y) => gdpYears.filter((x) => x === y).length > countries.length / 2));
const data = { width: map.width, height: map.height, sphere: map.sphere, other: map.other, areaYear, gdpYear, countries };
fs.writeFileSync("../data/data.js", "window.QUIZ_DATA = " + JSON.stringify(data) + ";\n");
console.log("data.js KB:", Math.round(fs.statSync("../data/data.js").size / 1024),
  "без флага:", countries.filter((c) => !c.flag).map((c) => c.code).join(" ") || "—",
  "без герба:", countries.filter((c) => !c.arms).map((c) => c.code).join(" ") || "—");
