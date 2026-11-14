// Скачивает из Wikidata названия на русском, английском и китайском (упрощённом)
// для стран, столиц, валют и языков, а также координаты столиц → tools/cache/i18n.json.
import fs from "fs";

const UA = "CountryQuizBuilder/1.0 (personal offline project)";
const wd = JSON.parse(fs.readFileSync("cache/wikidata.json", "utf8"));
const values = Object.values(wd.qids).map((q) => "wd:" + q).join(" ");

async function sparql(query) {
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
  if (!res.ok) throw new Error("SPARQL " + res.status + " " + (await res.text()).slice(0, 300));
  return (await res.json()).results.bindings;
}

// Для китайского берём zh-hans, иначе zh-cn, иначе zh
const labels = (v) => `
  OPTIONAL { ${v} rdfs:label ?ru FILTER(LANG(?ru) = "ru") }
  OPTIONAL { ${v} rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ${v} rdfs:label ?zhHans FILTER(LANG(?zhHans) = "zh-hans") }
  OPTIONAL { ${v} rdfs:label ?zhCn FILTER(LANG(?zhCn) = "zh-cn") }
  OPTIONAL { ${v} rdfs:label ?zh0 FILTER(LANG(?zh0) = "zh") }`;
const queries = {
  country: `SELECT ?c ?ru ?en ?zhHans ?zhCn ?zh0 WHERE { VALUES ?c { ${values} } ${labels("?c")} }`,
  capital: `SELECT ?c ?x ?coord ?ru ?en ?zhHans ?zhCn ?zh0 WHERE { VALUES ?c { ${values} } ?c wdt:P36 ?x .
    OPTIONAL { ?x wdt:P625 ?coord } ${labels("?x")} }`,
  currency: `SELECT ?c ?x ?ru ?en ?zhHans ?zhCn ?zh0 WHERE { VALUES ?c { ${values} } ?c wdt:P38 ?x . ${labels("?x")} }`,
  language: `SELECT ?c ?x ?ru ?en ?zhHans ?zhCn ?zh0 WHERE { VALUES ?c { ${values} } ?c wdt:P37 ?x . ${labels("?x")} }`,
};

const out = {};
for (const [name, q] of Object.entries(queries)) {
  out[name] = (await sparql(q)).map((row) => {
    const v = Object.fromEntries(Object.entries(row).map(([k, x]) => [k, x.value.replace("http://www.wikidata.org/entity/", "")]));
    const r = { c: v.c, x: v.x, ru: v.ru, en: v.en, zh: v.zhHans || v.zhCn || v.zh0 };
    const m = v.coord?.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (m) r.coord = [+m[1], +m[2]];
    return r;
  });
  console.log("wikidata", name, out[name].length);
}
fs.writeFileSync("cache/i18n.json", JSON.stringify(out));
