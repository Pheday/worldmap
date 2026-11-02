// Скачивает флаги и гербы с Wikimedia Commons в data/flags и data/arms (PNG-миниатюры).
// Уже скачанные файлы пропускает, так что скрипт можно перезапускать.
import fs from "fs";

const UA = "CountryQuizBuilder/1.0 (personal offline project)";
const countries = JSON.parse(fs.readFileSync("cache/countries.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(file, width, dest) {
  if (fs.existsSync(dest)) return "skip";
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429 || res.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
    if (!res.ok) return "HTTP " + res.status;
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return "ok";
  }
  return "retries exhausted";
}

for (const dir of ["../data/flags", "../data/arms"]) fs.mkdirSync(dir, { recursive: true });
const failed = [];
for (const [code, c] of Object.entries(countries)) {
  for (const [file, width, dir] of [[c.flagFile, 330, "flags"], [c.armsFile, 250, "arms"]]) {
    if (!file) continue;
    const result = await download(file, width, `../data/${dir}/${code}.png`);
    if (result !== "ok" && result !== "skip") failed.push(`${code} ${dir}: ${result} (${file})`);
    if (result === "ok") await sleep(300);
  }
}
console.log(failed.length ? "Ошибки:\n" + failed.join("\n") : "Все картинки скачаны");
