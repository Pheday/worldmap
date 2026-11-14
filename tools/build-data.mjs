// Сводит Wikidata, Всемирный банк и ручные правки в tools/cache/countries.json.
import fs from "fs";
import { NAME, CAPITAL, CURRENCY, LANGUAGE, FLAG_FILE, ARMS_FILE, NAME_I18N, CAPITAL_I18N, TERM_I18N } from "./overrides.mjs";

const wd = JSON.parse(fs.readFileSync("cache/wikidata.json", "utf8"));
const wb = JSON.parse(fs.readFileSync("cache/worldbank.json", "utf8"));
const i18n = JSON.parse(fs.readFileSync("cache/i18n.json", "utf8"));
const map = JSON.parse(fs.readFileSync("cache/map.json", "utf8"));

const group = (rows, key) => {
  const out = {};
  for (const r of rows) if (r[key] != null && r[key] !== "") (out[r.c] ??= new Set()).add(r[key]);
  return out;
};
const caps = group(wd.capital, "capName"), curs = group(wd.currency, "curName"), langs = group(wd.language, "langName");
const ruwiki = group(wd.ruwiki || [], "title");
const names = group(wd.base, "name"), isos = group(wd.base, "iso");
const flags = group(wd.base, "flag"), arms = group(wd.base, "arms"), emblems = group(wd.base, "emblem");
const first = (s) => (s ? [...s][0] : undefined);

// Население и площадь — самый свежий год, по которому у Всемирного банка есть данные почти по всем
function latest(rows) {
  const counts = {};
  for (const r of rows) counts[r.year] = (counts[r.year] || 0) + 1;
  const max = Math.max(...Object.values(counts));
  const year = Math.max(...Object.keys(counts).filter((y) => counts[y] >= max - 5).map(Number));
  return { year, values: Object.fromEntries(rows.filter((r) => r.year === year).map((r) => [r.iso, r.value])) };
}
const wbPop = latest(wb.population), wbArea = latest(wb.area), wbGdp = latest(wb.gdpPpp);

// ВВП: если за общий год данных нет — самый свежий год по этой стране
const gdpFallback = {};
for (const r of wb.gdpPpp) if (!gdpFallback[r.iso] || r.year > gdpFallback[r.iso].year) gdpFallback[r.iso] = r;

// Запасной вариант из Wikidata: самая свежая оценка
const wdPop = {};
for (const r of wd.population) {
  const year = r.date ? +r.date.slice(0, 4) : 0;
  if (!wdPop[r.c] || year > wdPop[r.c].year) wdPop[r.c] = { value: +r.pop, year };
}
const wdArea = {};
for (const r of wd.area) wdArea[r.c] = Math.max(wdArea[r.c] || 0, +r.area);

// «франк КФА» и т. п. оставляем как есть, у остальных — строчная первая буква
const lowerFirst = (s) => s.replace(/^[А-ЯЁ](?=[а-яё])/, (c) => c.toLowerCase());
const cleanLang = (s) => lowerFirst(s.replace(/\s*\(язык\)|^[Яя]зык\s+|\s+язык$/g, ""));
const fileName = (url) => url && decodeURIComponent(url.split("/").pop());

const countries = {};
for (const { code } of map.countries) {
  const q = wd.qids[code];
  const iso = first(isos[q]) || ({ PSX: "PSE", SAH: "ESH", NLD: "NLD" })[code];
  const pop = code === "ATA" ? null : wbPop.values[iso] != null ? { value: wbPop.values[iso], year: wbPop.year } : wdPop[q];
  const area = wbArea.values[iso] || wdArea[q];
  const gdp = wbGdp.values[iso] != null ? { value: wbGdp.values[iso], year: wbGdp.year } : gdpFallback[iso];
  countries[code] = {
    name: NAME[code] || first(names[q]),
    capital: code in CAPITAL ? CAPITAL[code] : first(caps[q]),
    population: pop ? Math.round(pop.value) : null,
    populationYear: pop?.year || null,
    area: area ? (area < 10 ? +area.toFixed(2) : Math.round(area)) : null,
    gdp: gdp ? Math.round(gdp.value) : null,
    gdpYear: gdp?.year || null,
    currency: CURRENCY[code] || [...(curs[q] || [])].map(lowerFirst),
    language: LANGUAGE[code] || [...(langs[q] || [])].map(cleanLang),
    flagFile: FLAG_FILE[code] || fileName(first(flags[q])),
    armsFile: ARMS_FILE[code] || fileName(first(arms[q])) || fileName(first(emblems[q])),
    armsIsEmblem: !ARMS_FILE[code] && !arms[q] && !!emblems[q],
    wiki: first(ruwiki[q]) || null,
  };
}
// Английский и китайский: Wikidata + правки из overrides.mjs
const LANGS = ["en", "zh"];
const upperFirst = (s) => s && s[0].toUpperCase() + s.slice(1);
const terms = {}; // русское название валюты/языка → { en, zh }
for (const r of i18n.currency) if (r.ru) terms[lowerFirst(r.ru)] ??= { en: upperFirst(r.en), zh: r.zh };
for (const r of i18n.language) if (r.ru) terms[cleanLang(r.ru)] ??= { en: upperFirst(r.en), zh: r.zh };
for (const [ru, [en, zh]] of Object.entries(TERM_I18N)) terms[ru] = { en: en ?? terms[ru]?.en, zh: zh ?? terms[ru]?.zh };
const missing = new Set();
const term = (ru, lang) => terms[ru]?.[lang] || (missing.add(`${lang}: ${ru}`), ru);
for (const [code, c] of Object.entries(countries)) {
  const q = wd.qids[code];
  const nameRow = i18n.country.find((r) => r.c === q);
  const capRow = c.capital && (i18n.capital.find((r) => r.c === q && r.ru === c.capital) || i18n.capital.find((r) => r.ru === c.capital));
  const capFix = CAPITAL_I18N[code];
  if (c.capital) {
    c.capitalCoord = capFix?.[2] || capRow?.coord || null;
    if (!c.capitalCoord) missing.add("координаты столицы: " + code);
  }
  for (const [i, lang] of LANGS.entries()) {
    const capital = c.capital ? capFix?.[i] || capRow?.[lang] : null;
    if (c.capital && !capital) missing.add(`${lang}: столица ${code}`);
    c[lang] = {
      name: NAME_I18N[code]?.[i] || nameRow?.[lang] || (missing.add(`${lang}: название ${code}`), c.name),
      capital: capital || c.capital,
      currency: c.currency.map((x) => term(x, lang)),
      language: c.language.map((x) => term(x, lang)),
    };
  }
}
if (missing.size) console.log("НЕТ ПЕРЕВОДА:", [...missing].join("; "));

fs.writeFileSync("cache/countries.json", JSON.stringify(countries, null, 1));

// Отчёт для ручной проверки
const ref = process.argv[2] && JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const refCaps = new Set(ref ? ref.map((r) => r.cap) : []);
for (const [code, c] of Object.entries(countries)) {
  const flags = [!c.capital && code !== "ATA" && "НЕТ СТОЛИЦЫ", ref && c.capital && !refCaps.has(c.capital) && "столица≠справочник",
    !c.population && "нет населения", !c.area && "нет площади", !c.gdp && "нет ВВП",!c.currency.length && "нет валюты",
    !c.language.length && "нет языка", !c.flagFile && "нет флага", !c.armsFile && "нет герба"].filter(Boolean);
  console.log(`${code} ${c.name} | ${c.capital} | ${c.population} (${c.populationYear}) | ${c.area} | ${c.gdp} (${c.gdpYear}) | ${c.currency.join(", ")} | ${c.language.join(", ")}${c.armsIsEmblem ? " | эмблема" : ""}${flags.length ? "  <<< " + flags.join("; ") : ""}`);
}
console.log("Население WB:", wbPop.year, "Площадь WB:", wbArea.year, "ВВП WB:", wbGdp.year);
