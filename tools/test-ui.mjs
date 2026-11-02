// Прогоняет основные сценарии в Chrome и сохраняет скриншоты: node test-ui.mjs <папка для скриншотов>
import puppeteer from "puppeteer-core";
import path from "path";
import { pathToFileURL } from "url";

const outDir = process.argv[2] || ".";
const shot = (page, name) => page.screenshot({ path: path.join(outDir, name + ".png") });
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  defaultViewport: { width: 1400, height: 850 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(pathToFileURL(path.resolve("../index.html")).href);

// Точка внутри контура страны в экранных координатах
const pointIn = (code) => page.evaluate((code) => {
  const el = document.querySelector(`.dot[data-code="${code}"]`) || document.querySelector(`.country[data-code="${code}"]`);
  const box = el.getBBox();
  const m = el.getScreenCTM();
  for (let i = 0; i < 4000; i++) {
    const x = box.x + Math.random() * box.width, y = box.y + Math.random() * box.height;
    if (el.isPointInFill(new DOMPoint(x, y))) {
      const p = new DOMPoint(x, y).matrixTransform(m);
      if (document.elementFromPoint(p.x, p.y)?.dataset.code === code) return { x: p.x, y: p.y };
    }
  }
  return null;
}, code);
// Перед кликом закрываем карточку — она может закрывать нужную страну
const click = async (code) => { await page.keyboard.press("Escape"); const p = await pointIn(code); await page.mouse.click(p.x, p.y); await new Promise((r) => setTimeout(r, 150)); };
const targetCode = () => page.evaluate(() => {
  const v = document.getElementById("questionValue");
  const img = v.querySelector("img");
  return QUIZ_DATA.countries.find((c) => (img ? img.getAttribute("src") === c.flag : c.name === v.textContent || c.capital === v.textContent)).code;
});

await page.click("#startBtn");
let target = await targetCode();
const wrong = target === "FRA" ? "DEU" : "FRA";
await click(wrong);
await shot(page, "1-wrong");
console.log("после ошибки:", await page.$eval("#cardVerdict", (e) => e.textContent), await page.$eval("#cardName", (e) => e.textContent));

await click(target);
console.log("отгадано:", target, "класс:", await page.$eval(`.country[data-code="${target}"]`, (e) => e.getAttribute("class")));
await click(target);
console.log("повторный клик:", await page.$eval("#cardVerdict", (e) => e.textContent));
await shot(page, "2-known");

// Три ошибки → фиолетовая подсказка → клик → красный
target = await targetCode();
const others = ["BRA", "CAN", "AUS", "CHN"].filter((c) => c !== target).slice(0, 3);
for (const c of others) await click(c);
console.log("подсказка:", await page.$eval(`[data-code="${target}"]`, (e) => e.getAttribute("class")));
await click(target);
console.log("после подсказки:", await page.$eval(`.country[data-code="${target}"]`, (e) => e.getAttribute("class")));

// Режим флагов и мелкая страна
await page.click("#menuBtn");
await page.click("input[value=flags]");
await page.click("#startBtn");
await shot(page, "3-flags");
await click("VAT");
await shot(page, "4-vatican");
console.log("Ватикан:", await page.$eval("#cardFacts", (e) => e.innerText.replace(/\n/g, " | ")));
const armsShown = () => page.$eval("#cardArms", (e) => e.parentElement.checkVisibility());
console.log("герб по умолчанию виден:", await armsShown());
await page.click("#settingsBtn");
await page.click('input[data-field="arms"]');
await page.click('input[data-field="area"]');
await shot(page, "4b-settings");
await page.click("#settingsClose");
console.log("герб после включения виден:", await armsShown(), "| поля:", await page.$eval("#cardFacts", (e) => e.innerText.replace(/\n/g, " | ")));
await page.reload();
console.log("настройки сохранились:", await page.$eval('input[data-field="arms"]', (e) => e.checked), await page.$eval('input[data-field="area"]', (e) => !e.checked));
await page.click("#startBtn");

await page.click("#enoughBtn");
await shot(page, "5-end");
console.log("итог:", await page.$eval("#endStats", (e) => e.innerText.replace(/\n/g, " ")));

await page.setViewport({ width: 390, height: 800 });
await page.click("#inspectBtn");
await click("BRA");
await shot(page, "6-mobile");

console.log("ошибки в консоли:", errors.length ? errors : "нет");
await browser.close();
