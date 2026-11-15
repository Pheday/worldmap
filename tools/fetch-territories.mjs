// Скачивает из Wikidata сведения об особых территориях (столица, население, площадь, валюта, языки,
// флаг, герб, коды ISO) с названиями на русском, английском и китайском → tools/cache/territories.json.
// Элемент Wikidata находится по статье в русской Википедии (поле wiki в territories.mjs) или задаётся полем qid.
import fs from "fs";
import { TERRITORIES } from "./territories.mjs";

const UA = "CountryQuizBuilder/1.0 (personal offline project)";

async function sparql(query) {
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
  if (!res.ok) throw new Error("SPARQL " + res.status + " " + (await res.text()).slice(0, 300));
  return (await res.json()).results.bindings.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value.replace("http://www.wikidata.org/entity/", "")])));
}

// Элементы по заголовкам статей
const byTitle = Object.entries(TERRITORIES).filter(([, t]) => !t.qid && !t.wikiSearch);
const titles = byTitle.map(([, t]) => JSON.stringify(t.wiki) + "@ru").join(" ");
const found = await sparql(`SELECT ?title ?c WHERE { VALUES ?title { ${titles} }
  ?article schema:name ?title ; schema:isPartOf <https://ru.wikipedia.org/> ; schema:about ?c }`);
const qids = {};
for (const [code, t] of Object.entries(TERRITORIES)) {
  qids[code] = t.qid || found.find((r) => r.title === t.wiki)?.c;
  if (!qids[code] && !t.wikiSearch) console.log("нет элемента Wikidata:", code, t.wiki);
}
for (const code of Object.keys(qids)) if (!qids[code]) delete qids[code];

const values = Object.values(qids).map((q) => "wd:" + q).join(" ");
// Для китайского берём zh-hans, иначе zh-cn, иначе zh
const labels = (v) => `
  OPTIONAL { ${v} rdfs:label ?ru FILTER(LANG(?ru) = "ru") }
  OPTIONAL { ${v} rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ${v} rdfs:label ?zhHans FILTER(LANG(?zhHans) = "zh-hans") }
  OPTIONAL { ${v} rdfs:label ?zhCn FILTER(LANG(?zhCn) = "zh-cn") }
  OPTIONAL { ${v} rdfs:label ?zh0 FILTER(LANG(?zh0) = "zh") }`;
const queries = {
  base: `SELECT ?c ?iso ?flag ?arms ?emblem WHERE { VALUES ?c { ${values} }
    OPTIONAL { ?c wdt:P298 ?iso }
    OPTIONAL { ?c wdt:P41 ?flag }
    OPTIONAL { ?c wdt:P94 ?arms }
    OPTIONAL { ?c wdt:P158 ?emblem } }`,
  capital: `SELECT ?c ?x ?ru ?en ?zhHans ?zhCn ?zh0 WHERE { VALUES ?c { ${values} } ?c wdt:P36 ?x . ${labels("?x")} }`,
  currency: `SELECT ?c ?x ?ru ?en ?zhHans ?zhCn ?zh0 WHERE { VALUES ?c { ${values} } ?c wdt:P38 ?x . ${labels("?x")} }`,
  language: `SELECT ?c ?x ?ru ?en ?zhHans ?zhCn ?zh0 WHERE { VALUES ?c { ${values} } ?c wdt:P37 ?x . ${labels("?x")} }`,
  population: `SELECT ?c ?pop ?date WHERE { VALUES ?c { ${values} }
    ?c p:P1082 ?st . ?st ps:P1082 ?pop . OPTIONAL { ?st pq:P585 ?date } }`,
  // Площадь приведена к м² (в Wikidata она бывает в км², гектарах, квадратных милях)
  area: `SELECT ?c ?area WHERE { VALUES ?c { ${values} } ?c p:P2046/psn:P2046/wikibase:quantityAmount ?area }`,
};
const out = { qids };
for (const [name, q] of Object.entries(queries)) {
  out[name] = (await sparql(q)).map(({ zhHans, zhCn, zh0, ...r }) => (zhHans || zhCn || zh0 ? { ...r, zh: zhHans || zhCn || zh0 } : r));
  console.log("wikidata", name, out[name].length);
}
fs.writeFileSync("cache/territories.json", JSON.stringify(out));
