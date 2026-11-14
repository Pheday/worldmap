// Серые территории: не самостоятельные государства, спорные и ничейные земли.
// По клику на карте показывается карточка: статус, кому принадлежит, кто претендует.
// kind — ключ статуса (тексты в i18n.js: terr_<kind>), owner / control / claim — коды стран из теста.
// name — только там, где у Natural Earth названия нет или оно неверное.
export const TERRITORIES = {
  // Великобритания
  GIB: { kind: "dep", owner: ["GBR"], claim: ["ESP"] },
  FLK: { kind: "dep", owner: ["GBR"], claim: ["ARG"] },
  SGS: { kind: "dep", owner: ["GBR"], claim: ["ARG"] },
  IOT: { kind: "dep", owner: ["GBR"], claim: ["MUS"] },
  TCA: { kind: "dep", owner: ["GBR"] },
  PCN: { kind: "dep", owner: ["GBR"] },
  MSR: { kind: "dep", owner: ["GBR"] },
  AIA: { kind: "dep", owner: ["GBR"] },
  VGB: { kind: "dep", owner: ["GBR"] },
  CYM: { kind: "dep", owner: ["GBR"] },
  BMU: { kind: "dep", owner: ["GBR"] },
  SHN: { kind: "dep", owner: ["GBR"] },
  JEY: { kind: "crown", owner: ["GBR"] },
  GGY: { kind: "crown", owner: ["GBR"] },
  IMN: { kind: "crown", owner: ["GBR"] },
  // Франция
  MAF: { kind: "dep", owner: ["FRA"] },
  BLM: { kind: "dep", owner: ["FRA"] },
  SPM: { kind: "dep", owner: ["FRA"] },
  NCL: { kind: "dep", owner: ["FRA"] },
  PYF: { kind: "dep", owner: ["FRA"] },
  WLF: { kind: "dep", owner: ["FRA"] },
  ATF: { kind: "dep", owner: ["FRA"] },
  CLP: { kind: "dep", owner: ["FRA"] },
  // Нидерланды
  ABW: { kind: "kingdom", owner: ["NLD"] },
  CUW: { kind: "kingdom", owner: ["NLD"] },
  SXM: { kind: "kingdom", owner: ["NLD"] },
  // Дания, Финляндия
  GRL: { kind: "auto", owner: ["DNK"] },
  FRO: { kind: "auto", owner: ["DNK"] },
  ALD: { kind: "auto", owner: ["FIN"] },
  // США
  PRI: { kind: "dep", owner: ["USA"] },
  VIR: { kind: "dep", owner: ["USA"] },
  GUM: { kind: "dep", owner: ["USA"] },
  MNP: { kind: "dep", owner: ["USA"] },
  ASM: { kind: "dep", owner: ["USA"] },
  UMI: { kind: "dep", owner: ["USA"] },
  // Австралия
  NFK: { kind: "dep", owner: ["AUS"] },
  IOA: { kind: "dep", owner: ["AUS"], name: { zh: "澳大利亚印度洋领地" } },
  HMD: { kind: "dep", owner: ["AUS"] },
  CSI: { kind: "dep", owner: ["AUS"] },
  ATC: { kind: "dep", owner: ["AUS"] },
  // Новая Зеландия
  COK: { kind: "assoc", owner: ["NZL"] },
  NIU: { kind: "assoc", owner: ["NZL"] },
  // Спорные
  BRI: { kind: "disputed", control: ["BRA"], claim: ["URY"] },
  B92: { kind: "disputed", control: ["BRA"], claim: ["URY"], name: { ru: "Ринкон-де-Артигас", en: "Rincón de Artigas", zh: "林孔德阿蒂加斯" } },
  "-99": { kind: "border", claim: ["ARG", "CHL"], name: { ru: "Южное Патагонское ледниковое плато", en: "Southern Patagonian Ice Field", zh: "南巴塔哥尼亚冰原" } },
  PFA: { kind: "disputed", control: ["CHN"], claim: ["VNM"], name: { ru: "Парасельские острова", en: "Paracel Islands", zh: "西沙群岛" } },
  PGA: { kind: "disputed", claim: ["CHN", "VNM", "PHL", "MYS", "BRN"], name: { ru: "острова Спратли", en: "Spratly Islands", zh: "南沙群岛" } },
  SCR: { kind: "disputed", control: ["CHN"], claim: ["PHL"] },
  KOD: { kind: "disputed", control: ["KOR"], claim: ["JPN"], name: { ru: "острова Лианкур (Токто / Такэсима)", en: "Liancourt Rocks (Dokdo / Takeshima)", zh: "独岛／竹岛" } },
  DEN: { kind: "divided", owner: ["CAN", "DNK"], name: { ru: "остров Ханс", en: "Hans Island", zh: "汉斯岛" } },
  // Ничьи
  BRT: { kind: "nullius", neither: ["EGY", "SDN"] },
  ATA: { kind: "ata", claim: ["AUS", "ARG", "GBR", "NZL", "NOR", "FRA", "CHL"] },
};
