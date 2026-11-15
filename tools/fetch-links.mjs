// Заголовки статей русской Википедии (в Рувики они те же) о столицах и валютах стран и особых территорий
// → tools/cache/links.json. Запускается после build-data.mjs: берёт итоговые названия с учётом overrides.mjs.
// Статья ищется сначала среди столиц/валют этой страны в Wikidata (так «Гамильтон» — город на Бермудах,
// а не страница неоднозначности), затем по названию в Википедии (кроме страниц неоднозначности);
// что не нашлось — WIKI_TITLE в overrides.mjs (null — ссылки нет).
import fs from "fs";
import { WIKI_TITLE } from "./overrides.mjs";

const UA = "CountryQuizBuilder/1.0 (personal offline project)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qids = { ...JSON.parse(fs.readFileSync("cache/wikidata.json", "utf8")).qids, ...JSON.parse(fs.readFileSync("cache/territories.json", "utf8")).qids };
const info = { ...JSON.parse(fs.readFileSync("cache/countries.json", "utf8")), ...JSON.parse(fs.readFileSync("cache/territory-info.json", "utf8")) };

async function sparql(query) {
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
  if (!res.ok) throw new Error("SPARQL " + res.status + " " + (await res.text()).slice(0, 300));
  return (await res.json()).results.bindings.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value.replace("http://www.wikidata.org/entity/", "")])));
}
const values = [...new Set(Object.values(qids))].map((q) => "wd:" + q).join(" ");
const items = (prop) => sparql(`SELECT ?c ?ru ?title WHERE { VALUES ?c { ${values} } ?c wdt:${prop} ?x .
  OPTIONAL { ?x rdfs:label ?ru FILTER(LANG(?ru) = "ru") }
  ?article schema:about ?x ; schema:isPartOf <https://ru.wikipedia.org/> ; schema:name ?title }`);
const wd = { capital: await items("P36"), currency: await items("P38") };

const norm = (s) => s.toLowerCase().replace(/ё/g, "е");
const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fromWd = (code, kind, name) => wd[kind].find((r) => r.c === qids[code] && r.ru && norm(r.ru) === norm(name))?.title;

// Остальное — поиском по названию, по 50 заголовков за запрос: перенаправления разрешаются,
// страницы неоднозначности отбрасываются
const toLookup = new Set();
for (const [code, c] of Object.entries(info))
  for (const [kind, name] of [["capital", c.capital], ...c.currency.map((x) => ["currency", x])])
    if (name && !(name in WIKI_TITLE) && !fromWd(code, kind, name)) toLookup.add(upper(name));
const byName = {};
async function api(titles) {
  const url = "https://ru.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=disambiguation&titles="
    + encodeURIComponent(titles.join("|"));
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return (await res.json()).query;
    await sleep(5000 * (attempt + 1));
  }
  throw new Error("Википедия не отвечает");
}
const names = [...toLookup];
for (let i = 0; i < names.length; i += 50) {
  const q = await api(names.slice(i, i + 50));
  const map = (list) => Object.fromEntries((list || []).map((r) => [r.from, r.to]));
  const normalized = map(q.normalized), redirects = map(q.redirects);
  const pages = Object.fromEntries(Object.values(q.pages).map((p) => [p.title, p]));
  for (const name of names.slice(i, i + 50)) {
    const t0 = normalized[name] || name, t = redirects[t0] || t0, p = pages[t];
    byName[name] = !p || p.missing !== undefined || p.pageprops?.disambiguation !== undefined ? null : p.title;
  }
  await sleep(1000);
}

const missing = [];
function title(code, kind, name) {
  const t = name in WIKI_TITLE ? WIKI_TITLE[name] : fromWd(code, kind, name) || byName[upper(name)];
  if (!t && !(name in WIKI_TITLE)) missing.push(`${code} ${kind}: ${name}`);
  return t || null;
}
const out = {};
for (const [code, c] of Object.entries(info))
  out[code] = { capital: c.capital ? title(code, "capital", c.capital) : null, currency: c.currency.map((x) => title(code, "currency", x)) };
fs.writeFileSync("cache/links.json", JSON.stringify(out, null, 1));
console.log(missing.length ? "НЕТ СТАТЬИ (добавьте в WIKI_TITLE):\n" + missing.join("\n") : "Все статьи найдены");
