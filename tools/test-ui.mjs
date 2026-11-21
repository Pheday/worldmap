// Прогоняет основные сценарии в Chrome и сохраняет скриншоты: node test-ui.mjs [папка для скриншотов]
// Без папки — во временную папку системы, чтобы скриншоты не копились в проекте
import puppeteer from "puppeteer-core";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "quiz-ui-"));
console.log("скриншоты:", outDir);
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
  return QUIZ_DATA.countries.find((c) => (img ? img.getAttribute("src") === c.flag : Object.values(c.name).includes(v.textContent) || Object.values(c.capital || {}).includes(v.textContent))).code;
});

// Язык выбирается в выпадающем меню у флажка в шапке. Кликаем через DOM: в начале шапку
// закрывает затемнение стартового диалога
const setLang = (lang) => page.evaluate((lang) => {
  document.getElementById("langBtn").click();
  document.querySelector(`#langMenu li[data-lang="${lang}"]`).click();
}, lang);

await setLang("ru");
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
await click("SLB");
console.log("Соломоновы — обводка вместо кружка:", !!(await page.$('.archi-area[data-code="SLB"]')) && !(await page.$('.dot[data-code="SLB"]')), "| точек столиц:", await page.$$eval(".capital", (e) => e.length), "| выделено:", await page.$$eval(".capital.selected", (e) => e.length));
await shot(page, "4a-solomon");
await click("VAT");
await shot(page, "4-vatican");
console.log("Ватикан:", await page.$eval("#cardFacts", (e) => e.innerText.replace(/\n/g, " | ")));
console.log("Ватикан, ссылки:", await page.$$eval("#cardFacts a", (a) => a.map((e) => decodeURIComponent(e.href.split("/wiki/")[1])).join(", ")));
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

for (const lang of ["en", "zh"]) {
  await setLang(lang);
  await shot(page, "5-end-" + lang);
  console.log(lang, "итог:", await page.$eval("#endTitle", (e) => e.textContent), "|", await page.$eval("#endStats", (e) => e.innerText.replace(/\n/g, " ")));
}
await page.click("#inspectBtn");
await click("CHN");
console.log("zh карточка:", await page.$eval("#cardName", (e) => e.textContent), "|", await page.$eval("#cardFacts", (e) => e.innerText.replace(/\n/g, " | ")));
await shot(page, "5b-zh-card");
await setLang("en");
console.log("en карточка:", await page.$eval("#cardName", (e) => e.textContent), "|", await page.$eval("#cardFacts", (e) => e.innerText.replace(/\n/g, " | ")));
await shot(page, "5c-en-card");
// Особые территории: кружками не рисуются, карточка — со ссылкой на статью о статусе
console.log("серых кружков:", await page.$$eval(".dot[data-territory]", (e) => e.length));
await page.keyboard.press("Escape");
const grl = await page.evaluate(() => {
  const r = document.querySelector('path[data-territory="GRL"]').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(grl.x, grl.y);
await new Promise((r) => setTimeout(r, 150));
console.log("Гренландия:", await page.$eval("#cardName", (e) => e.textContent), "| статус:",
  await page.$eval("#cardFacts a", (e) => e.textContent + " → " + decodeURIComponent(e.href)));
console.log("Гренландия, сведения:", await page.$eval("#cardFacts", (e) => e.innerText.replace(/\n/g, " | ")));
console.log("Гренландия, ссылки:", await page.$$eval("#cardFacts a", (a) => a.map((e) => decodeURIComponent(e.href.split("/wiki/")[1])).join(", ")));
await shot(page, "5d-grey-card");
await page.keyboard.press("Escape");
// Гренландия крупным планом занимает большую часть карты — карточка ставится рядом с кликом, а не на край
await page.mouse.move(grl.x, grl.y);
for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: -300 }); await new Promise((r) => setTimeout(r, 60)); }
await new Promise((r) => setTimeout(r, 400));
await page.mouse.click(400, 250);
await new Promise((r) => setTimeout(r, 300));
console.log("Гренландия крупно, карточка:", await page.$eval("#card", (e) => e.style.left + " " + e.style.top), "клик: 400 250");
await shot(page, "5e-grey-card-zoomed");
await page.keyboard.press("Escape");
await page.click("#zoomReset");
await new Promise((r) => setTimeout(r, 400));

// Обратный режим: страна подсвечена, столицу пишут сами
await setLang("ru");
const capitalOf = (code) => page.evaluate((code) => QUIZ_DATA.countries.find((c) => c.code === code).capital.ru, code);
const answer = async (text) => {
  await page.$eval("#answerInput", (e) => { e.value = ""; });
  await page.type("#answerInput", text);
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 150));
};
const cardLine = () => page.$eval("#card", (e) => e.hidden ? "(карточки нет)"
  : document.getElementById("cardVerdict").textContent + " / " + document.getElementById("cardName").textContent);
await page.click("#menuBtn");
await page.click("input[value=nameCapital]");
await page.click("#startBtn");
target = await targetCode();
console.log("назвать столицу:", target, "| подсвечена:", await page.$eval(`[data-code="${target}"]`, (e) => e.classList.contains("target")),
  "| фокус в поле:", await page.evaluate(() => document.activeElement.id));
await click(target);
console.log("карточка спрашиваемой страны без столицы:", !(await page.$eval("#cardFacts", (e) => e.innerText.includes("Столица"))));
await page.keyboard.press("Escape");
await shot(page, "7-type-capital");
const otherCap = target === "FRA" ? "берлин" : "париж";
await answer(otherCap);
console.log("чужая столица:", await cardLine());
await shot(page, "7a-type-wrong");
const cap = await capitalOf(target);
await answer(cap.length >= 5 ? cap.slice(0, 2) + cap.slice(3) : cap); // с опечаткой
console.log("с опечаткой:", cap, "→", await page.$eval(`[data-code="${target}"]`, (e) => e.getAttribute("class")), "|", await cardLine());
await shot(page, "7b-type-right");
target = await targetCode();
for (const w of ["абв", "где", "ёжик"]) await answer(w);
console.log("три ошибки:", target, await page.$eval(`[data-code="${target}"]`, (e) => e.getAttribute("class")), "|", await cardLine());
target = await targetCode();
await page.click("#dunnoBtn");
console.log("не знаю:", target, await page.$eval(`[data-code="${target}"]`, (e) => e.getAttribute("class")), "|", await cardLine());

// Тот же режим, выбор из списка: поиск при вводе и полный список по кнопке
// При вводе список сам не открывается; кнопка — все столицы, ввод при открытом списке — сужает
await page.type("#answerInput", "бер");
console.log("ввод без кнопки, список открыт:", await page.$eval("#answerList", (e) => !e.hidden));
await page.$eval("#answerInput", (e) => { e.value = ""; });
await page.click("#answerToggle");
console.log("полный список:", await page.$$eval("#answerList li", (e) => e.length), "столиц, первые:",
  await page.$$eval("#answerList li", (e) => e.slice(0, 3).map((x) => x.textContent).join(", ")));
await shot(page, "8a-pick-all");
await page.type("#answerInput", "бер");
console.log("поиск «бер» в открытом списке:", await page.$$eval("#answerList li", (e) => e.map((x) => x.textContent).join(", ")));
await shot(page, "8-pick-search");
await page.$eval("#answerInput", (e) => { e.value = ""; });
await page.click("#answerToggle");
target = await targetCode();
await page.type("#answerInput", (await capitalOf(target)).slice(0, 4));
await page.keyboard.press("ArrowDown"); // открывает список подходящих
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowUp");
const picked = await page.$eval("#answerList li.active", (e) => e.textContent);
await page.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 150));
console.log("выбор стрелками:", picked, "|", target, await page.$eval(`[data-code="${target}"]`, (e) => e.getAttribute("class")), "|", await cardLine());
await shot(page, "8b-pick-right");
target = await targetCode();
await page.click("#answerToggle");
await page.evaluate((cap) => [...document.querySelectorAll("#answerList li")].find((li) => li.textContent === cap).click(), await capitalOf(target));
await new Promise((r) => setTimeout(r, 150));
console.log("выбор мышью:", target, await page.$eval(`[data-code="${target}"]`, (e) => e.getAttribute("class")));
await setLang("en");
console.log("en:", await page.$eval("#questionLabel", (e) => e.textContent), "|", await page.$eval("#answerInput", (e) => e.placeholder), "|", await cardLine());
await shot(page, "8c-pick-en");
await setLang("ru");
await page.click("#enoughBtn");
console.log("итог по столицам:", await page.$eval("#endTitle", (e) => e.textContent), "|", await page.$eval("#endStats", (e) => e.innerText.replace(/\n/g, " ")));

await page.click("#againBtn");
await page.click("#menuBtn");
await page.click("input[value=countries]");
await page.click("#startBtn");
await page.click("#enoughBtn");

await page.setViewport({ width: 390, height: 800 });
await page.click("#inspectBtn");
await click("BRA");
await shot(page, "6-mobile");
console.log("телефон, столиц видно без зума:", await page.$$eval(".capitals:not(.capital-mark) .capital", (e) => e.filter((d) => d.style.display !== "none").length));
await page.keyboard.press("Escape");
await page.click("#settingsBtn");
await shot(page, "6b-mobile-settings");
await page.click("#settingsClose");
// Телефон в режиме выбора столицы: поле внизу, карточка — сверху
await page.click("#menuBtn");
await page.click("input[value=nameCapital]");
await page.click("#startBtn");
await page.click("#answerToggle");
await shot(page, "6c-mobile-pick-list");
await page.click("#answerToggle");
target = await targetCode();
await page.type("#answerInput", await capitalOf(target));
await page.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 300));
console.log("телефон, после ответа:", await cardLine());
await shot(page, "6d-mobile-pick-right");

console.log("ошибки в консоли:", errors.length ? errors : "нет");
await browser.close();
