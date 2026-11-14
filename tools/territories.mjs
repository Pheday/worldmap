// Серые территории: не самостоятельные государства, спорные и ничейные земли.
// По клику на карте показывается карточка: статус, кому принадлежит, кто претендует.
// kind — ключ статуса (тексты в i18n.js: terr_<kind>), owner / control / claim — коды стран из теста.
// wiki — заголовок статьи в Рувики (ru.ruwiki.ru), сверен с русской Википедией (сам Рувики закрыт для автоматических запросов);
// wikiSearch — статьи нет, ссылка ведёт на поиск по Рувики.
// name — только там, где у Natural Earth названия нет или оно неверное.
export const TERRITORIES = {
  // Великобритания
  GIB: { kind: "dep", owner: ["GBR"], claim: ["ESP"], wiki: "Гибралтар" },
  FLK: { kind: "dep", owner: ["GBR"], claim: ["ARG"], wiki: "Фолклендские острова" },
  SGS: { kind: "dep", owner: ["GBR"], claim: ["ARG"], wiki: "Южная Георгия и Южные Сандвичевы Острова" },
  IOT: { kind: "dep", owner: ["GBR"], claim: ["MUS"], wiki: "Британская Территория в Индийском Океане" },
  TCA: { kind: "dep", owner: ["GBR"], wiki: "Теркс и Кайкос" },
  PCN: { kind: "dep", owner: ["GBR"], wiki: "Острова Питкэрн" },
  MSR: { kind: "dep", owner: ["GBR"], wiki: "Монтсеррат" },
  AIA: { kind: "dep", owner: ["GBR"], wiki: "Ангилья" },
  VGB: { kind: "dep", owner: ["GBR"], wiki: "Виргинские Острова (Великобритания)" },
  CYM: { kind: "dep", owner: ["GBR"], wiki: "Каймановы Острова" },
  BMU: { kind: "dep", owner: ["GBR"], wiki: "Бермудские Острова" },
  SHN: { kind: "dep", owner: ["GBR"], name: { ru: "Острова Святой Елены, Вознесения и Тристан-да-Кунья", en: "Saint Helena, Ascension and Tristan da Cunha", zh: "圣赫勒拿、阿森松和特里斯坦-达库尼亚" }, wiki: "Острова Святой Елены, Вознесения и Тристан-да-Кунья" },
  JEY: { kind: "crown", owner: ["GBR"], wiki: "Джерси" },
  GGY: { kind: "crown", owner: ["GBR"], wiki: "Гернси" },
  IMN: { kind: "crown", owner: ["GBR"], wiki: "Остров Мэн" },
  // Франция
  MAF: { kind: "dep", owner: ["FRA"], wiki: "Сен-Мартен (владение Франции)" },
  BLM: { kind: "dep", owner: ["FRA"], wiki: "Сен-Бартелеми (заморское сообщество)" },
  SPM: { kind: "dep", owner: ["FRA"], wiki: "Сен-Пьер и Микелон" },
  NCL: { kind: "dep", owner: ["FRA"], wiki: "Новая Каледония" },
  PYF: { kind: "dep", owner: ["FRA"], wiki: "Французская Полинезия" },
  WLF: { kind: "dep", owner: ["FRA"], wiki: "Уоллис и Футуна" },
  ATF: { kind: "dep", owner: ["FRA"], wiki: "Французские Южные и Антарктические территории" },
  CLP: { kind: "dep", owner: ["FRA"], wiki: "Клиппертон" },
  // Нидерланды
  ABW: { kind: "kingdom", owner: ["NLD"], wiki: "Аруба" },
  CUW: { kind: "kingdom", owner: ["NLD"], wiki: "Кюрасао" },
  SXM: { kind: "kingdom", owner: ["NLD"], wiki: "Синт-Мартен" },
  // Дания, Финляндия
  GRL: { kind: "auto", owner: ["DNK"], wiki: "Гренландия" },
  FRO: { kind: "auto", owner: ["DNK"], wiki: "Фарерские острова" },
  ALD: { kind: "auto", owner: ["FIN"], wiki: "Аландские острова" },
  // США
  PRI: { kind: "dep", owner: ["USA"], wiki: "Пуэрто-Рико" },
  VIR: { kind: "dep", owner: ["USA"], wiki: "Виргинские Острова (США)" },
  GUM: { kind: "dep", owner: ["USA"], wiki: "Гуам" },
  MNP: { kind: "dep", owner: ["USA"], wiki: "Северные Марианские Острова" },
  ASM: { kind: "dep", owner: ["USA"], wiki: "Американское Самоа" },
  UMI: { kind: "dep", owner: ["USA"], wiki: "Внешние малые острова США" },
  // Австралия
  NFK: { kind: "dep", owner: ["AUS"], wiki: "Остров Норфолк" },
  IOA: { kind: "dep", owner: ["AUS"], name: { zh: "澳大利亚印度洋领地" }, wiki: "Австралийские территории в Индийском океане" },
  HMD: { kind: "dep", owner: ["AUS"], wiki: "Остров Херд и острова Макдональд" },
  CSI: { kind: "dep", owner: ["AUS"], wiki: "Территория островов Кораллового моря" },
  ATC: { kind: "dep", owner: ["AUS"], wiki: "Острова Ашмор и Картье" },
  // Новая Зеландия
  COK: { kind: "assoc", owner: ["NZL"], wiki: "Острова Кука" },
  NIU: { kind: "assoc", owner: ["NZL"], wiki: "Ниуэ" },
  // Спорные
  BRI: { kind: "disputed", control: ["BRA"], claim: ["URY"], wiki: "Бразилера", wikiSearch: true },
  B92: { kind: "disputed", control: ["BRA"], claim: ["URY"], name: { ru: "Ринкон-де-Артигас", en: "Rincón de Artigas", zh: "林孔德阿蒂加斯" }, wiki: "Ринкон-де-Артигас" },
  "-99": { kind: "border", claim: ["ARG", "CHL"], name: { ru: "Южное Патагонское ледниковое плато", en: "Southern Patagonian Ice Field", zh: "南巴塔哥尼亚冰原" }, wiki: "Южное Патагонское ледниковое плато" },
  PFA: { kind: "disputed", control: ["CHN"], claim: ["VNM"], name: { ru: "Парасельские острова", en: "Paracel Islands", zh: "西沙群岛" }, wiki: "Парасельские острова" },
  PGA: { kind: "disputed", claim: ["CHN", "VNM", "PHL", "MYS", "BRN"], name: { ru: "Острова Спратли", en: "Spratly Islands", zh: "南沙群岛" }, wiki: "Спратли" },
  SCR: { kind: "disputed", control: ["CHN"], claim: ["PHL"], wiki: "Скарборо (риф)" },
  KOD: { kind: "disputed", control: ["KOR"], claim: ["JPN"], name: { ru: "Острова Лианкур (Токто / Такэсима)", en: "Liancourt Rocks (Dokdo / Takeshima)", zh: "独岛／竹岛" }, wiki: "Лианкур" },
  DEN: { kind: "divided", owner: ["CAN", "DNK"], name: { ru: "Остров Ханс", en: "Hans Island", zh: "汉斯岛" }, wiki: "Ханс (остров)" },
  // Ничьи
  BRT: { kind: "nullius", neither: ["EGY", "SDN"], wiki: "Бир-Тавиль" },
  ATA: { kind: "ata", claim: ["AUS", "ARG", "GBR", "NZL", "NOR", "FRA", "CHL"], wiki: "Антарктида" },
};
