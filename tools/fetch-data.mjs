// Скачивает сведения о странах из Wikidata и Всемирного банка в tools/cache/.
import fs from "fs";

const UA = "CountryQuizBuilder/1.0 (personal offline project)";
const map = JSON.parse(fs.readFileSync("cache/map.json", "utf8"));

// В Natural Earth для Палестины стоит «Палестинские территории», нам нужно государство
const QID_FIX = { PSX: "Q219060" };
const qids = map.countries.map((c) => QID_FIX[c.code] || c.qid);

async function sparql(query) {
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
  if (!res.ok) throw new Error("SPARQL " + res.status + " " + (await res.text()).slice(0, 300));
  return (await res.json()).results.bindings;
}

const values = qids.map((q) => "wd:" + q).join(" ");
const label = (v, p) => `OPTIONAL { ${v} rdfs:label ${p} FILTER(LANG(${p}) = "ru") }`;
const queries = {
  base: `SELECT ?c ?name ?iso ?flag ?arms ?emblem WHERE { VALUES ?c { ${values} }
    ${label("?c", "?name")}
    OPTIONAL { ?c wdt:P298 ?iso }
    OPTIONAL { ?c wdt:P41 ?flag }
    OPTIONAL { ?c wdt:P94 ?arms }
    OPTIONAL { ?c wdt:P158 ?emblem } }`,
  capital: `SELECT ?c ?capName WHERE { VALUES ?c { ${values} } ?c wdt:P36 ?cap . ${label("?cap", "?capName")} }`,
  currency: `SELECT ?c ?curName WHERE { VALUES ?c { ${values} } ?c wdt:P38 ?cur . ${label("?cur", "?curName")} }`,
  language: `SELECT ?c ?langName WHERE { VALUES ?c { ${values} } ?c wdt:P37 ?lang . ${label("?lang", "?langName")} }`,
  population: `SELECT ?c ?pop ?date WHERE { VALUES ?c { ${values} }
    ?c p:P1082 ?st . ?st ps:P1082 ?pop . OPTIONAL { ?st pq:P585 ?date } }`,
  area: `SELECT ?c ?area WHERE { VALUES ?c { ${values} } ?c wdt:P2046 ?area }`,
};

const wd = {};
for (const [name, q] of Object.entries(queries)) {
  wd[name] = (await sparql(q)).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value.replace("http://www.wikidata.org/entity/", "")])));
  console.log("wikidata", name, wd[name].length);
}
fs.writeFileSync("cache/wikidata.json", JSON.stringify({ qids: Object.fromEntries(map.countries.map((c, i) => [c.code, qids[i]])), ...wd }));

async function worldBank(indicator) {
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000&date=2015:2025`;
  const [, rows] = await (await fetch(url, { headers: { "User-Agent": UA } })).json();
  return rows.filter((r) => r.value != null).map((r) => ({ iso: r.countryiso3code, year: +r.date, value: r.value }));
}
const wb = {
  population: await worldBank("SP.POP.TOTL"),
  area: await worldBank("AG.SRF.TOTL.K2"),
  gdpPpp: await worldBank("NY.GDP.PCAP.PP.CD"), // ВВП по ППС на душу, текущие международные доллары
};
console.log("worldbank", wb.population.length, wb.area.length, wb.gdpPpp.length);
fs.writeFileSync("cache/worldbank.json", JSON.stringify(wb));
