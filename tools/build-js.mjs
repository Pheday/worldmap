// Собирает data/data.js для страницы: контуры + сведения о странах.
// Данные лежат в JS, а не в JSON, чтобы index.html открывался прямо с диска (file://).
import fs from "fs";

const map = JSON.parse(fs.readFileSync("cache/map.json", "utf8"));
const info = JSON.parse(fs.readFileSync("cache/countries.json", "utf8"));
const wb = JSON.parse(fs.readFileSync("cache/worldbank.json", "utf8"));

const countries = map.countries.map(({ code, d, dot }) => {
  const c = info[code];
  return {
    code, d, dot,
    name: c.name, capital: c.capital, population: c.population, populationYear: c.populationYear,
    area: c.area, gdp: c.gdp, gdpYear: c.gdpYear, currency: c.currency, language: c.language,
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
