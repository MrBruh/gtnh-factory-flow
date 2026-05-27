import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const sourceRoot = path.resolve(
  process.env.GTNH_SOURCE_ROOT ?? path.join(repoRoot, ".pipeline", "gtnh-full"),
);
const outputPath = path.resolve(
  process.argv[2] ?? path.join(scriptDir, "..", "data", "bee-production-catalog.json"),
);

const FORESTRY_COMB_ORDER = [
  "HONEY",
  "COCOA",
  "SIMMERING",
  "STRINGY",
  "FROZEN",
  "DRIPPING",
  "SILKY",
  "PARCHED",
  "MYSTERIOUS",
  "IRRADIATED",
  "POWDERY",
  "REDDENED",
  "DARKENED",
  "OMEGA",
  "WHEATEN",
  "MOSSY",
  "MELLOW",
];
const VANILLA_COMB_ORDER = [
  "HONEY",
  "COCOA",
  "SIMMERING",
  "STRINGY",
  "FROZEN",
  "DRIPPING",
  "SILKY",
  "PARCHED",
  "MYSTERIOUS",
  "IRRADIATED",
  "POWDERY",
  "REDDENED",
  "DARKENED",
  "OMEGA",
  "WHEATEN",
  "MOSSY",
  "QUARTZ",
];
const VANILLA_COMB_DISPLAY_OVERRIDES = new Map([["QUARTZ", "Mellow Comb"]]);

const VANILLA_ITEM_MAP = new Map(
  Object.entries({
    apple: ["minecraft:apple", "Apple"],
    beef: ["minecraft:beef", "Raw Beef"],
    blaze_powder: ["minecraft:blaze_powder", "Blaze Powder"],
    blaze_rod: ["minecraft:blaze_rod", "Blaze Rod"],
    cake: ["minecraft:cake", "Cake"],
    carrot: ["minecraft:carrot", "Carrot"],
    chicken: ["minecraft:chicken", "Raw Chicken"],
    clay_ball: ["minecraft:clay_ball", "Clay"],
    coal: ["minecraft:coal", "Coal"],
    cooked_beef: ["minecraft:cooked_beef", "Steak"],
    cooked_porkchop: ["minecraft:cooked_porkchop", "Cooked Porkchop"],
    cookie: ["minecraft:cookie", "Cookie"],
    dye: ["minecraft:dye", "Dye"],
    egg: ["minecraft:egg", "Egg"],
    ender_pearl: ["minecraft:ender_pearl", "Ender Pearl"],
    feather: ["minecraft:feather", "Feather"],
    fish: ["minecraft:fish", "Raw Fish"],
    ghast_tear: ["minecraft:ghast_tear", "Ghast Tear"],
    glowstone_dust: ["minecraft:glowstone_dust", "Glowstone Dust"],
    gold_nugget: ["minecraft:gold_nugget", "Gold Nugget"],
    gunpowder: ["minecraft:gunpowder", "Gunpowder"],
    leather: ["minecraft:leather", "Leather"],
    melon: ["minecraft:melon", "Melon"],
    redstone: ["minecraft:redstone", "Redstone"],
    rotten_flesh: ["minecraft:rotten_flesh", "Rotten Flesh"],
    skull: ["minecraft:skull", "Skull"],
    slime_ball: ["minecraft:slime_ball", "Slimeball"],
    spider_eye: ["minecraft:spider_eye", "Spider Eye"],
    string: ["minecraft:string", "String"],
    sugar: ["minecraft:sugar", "Sugar"],
    wheat: ["minecraft:wheat", "Wheat"],
  }),
);

const VANILLA_BLOCK_MAP = new Map(
  Object.entries({
    ice: ["minecraft:ice", "Ice"],
    red_flower: ["minecraft:red_flower", "Flower"],
    wool: ["minecraft:wool", "Wool"],
  }),
);

const MOD_ID_ALIASES = new Map(
  Object.entries({
    BiomesOPlenty: "BiomesOPlenty",
    CropsPlusPlus: "berriespp",
    ExtraBees: "ExtraBees",
    Forestry: "Forestry",
    IndustrialCraft2: "IC2",
    MagicBees: "MagicBees",
    NewHorizonsCoreMod: "dreamcraft",
    TinkerConstruct: "TConstruct",
  }),
);

const forestryLang = await readLang(
  "ForestryMC/src/main/resources/assets/forestry/lang/en_US.lang",
);
const extraBeesLang = await readLang("Binnie/src/main/resources/assets/extrabees/lang/en_US.lang");
const magicBeesLang = await readLang(
  "MagicBees/src/main/resources/assets/magicbees/lang/en_US.lang",
);
const avaritiaLang = await readLang("Avaritia/src/main/resources/assets/avaritia/lang/en_US.lang");

const forestryCombs = FORESTRY_COMB_ORDER.map((name, meta) =>
  itemProduct("Forestry:beeCombs", meta, `${titleWords(name).join(" ")} Comb`),
);
const forestryCombByName = new Map(
  FORESTRY_COMB_ORDER.map((name, index) => [name, forestryCombs[index]]),
);
const forestryCombByMeta = new Map(forestryCombs.map((product, meta) => [meta, product]));
const vanillaCombByName = new Map(
  VANILLA_COMB_ORDER.map((name, meta) => [
    name,
    itemProduct(
      "Forestry:beeCombs",
      meta,
      VANILLA_COMB_DISPLAY_OVERRIDES.get(name) ??
        forestryCombByMeta.get(meta)?.displayName ??
        `${titleWords(name).join(" ")} Comb`,
    ),
  ]),
);

const extraBeesCombs = await enumItemProducts({
  file: "Binnie/src/main/java/binnie/extrabees/products/EnumHoneyComb.java",
  enumName: "EnumHoneyComb",
  baseId: "ExtraBees:honeyComb",
  labelFor: (name) =>
    extraBeesLang.get(`extrabees.item.comb.${name.toLowerCase()}`) ??
    `${titleWords(name).join(" ")} Comb`,
});
const magicCombTypes = await enumItemProducts({
  file: "MagicBees/src/main/java/magicbees/item/types/CombType.java",
  enumName: "CombType",
  baseId: "MagicBees:comb",
  labelFor: (_name, entry) => {
    const localKey = firstStringArg(entry.args) ?? _name.toLowerCase();
    return magicBeesLang.get(`comb.${localKey}`) ?? `${titleWords(localKey).join(" ")} Comb`;
  },
});
const magicDropTypes = await enumItemProducts({
  file: "MagicBees/src/main/java/magicbees/item/types/DropType.java",
  enumName: "DropType",
  baseId: "MagicBees:drop",
  labelFor: (_name, entry) => {
    const localKey = firstStringArg(entry.args) ?? _name.toLowerCase();
    return magicBeesLang.get(`drop.${localKey}`) ?? `${titleWords(localKey).join(" ")} Drop`;
  },
});
const magicPollenTypes = await enumItemProducts({
  file: "MagicBees/src/main/java/magicbees/item/types/PollenType.java",
  enumName: "PollenType",
  baseId: "MagicBees:pollen",
  labelFor: (_name, entry) => {
    const localKey = firstStringArg(entry.args) ?? _name.toLowerCase();
    return magicBeesLang.get(`pollen.${localKey}`) ?? `${titleWords(localKey).join(" ")} Pollen`;
  },
});
const magicPropolisTypes = await enumItemProducts({
  file: "MagicBees/src/main/java/magicbees/item/types/PropolisType.java",
  enumName: "PropolisType",
  baseId: "MagicBees:propolis",
  labelFor: (_name, entry) => {
    const localKey = firstStringArg(entry.args) ?? _name.toLowerCase();
    return (
      magicBeesLang.get(`propolis.${localKey}`) ?? `${titleWords(localKey).join(" ")} Propolis`
    );
  },
});
const magicResourceTypes = await enumItemProducts({
  file: "MagicBees/src/main/java/magicbees/item/types/ResourceType.java",
  enumName: "ResourceType",
  baseId: "MagicBees:miscResources",
  labelFor: (_name, entry) => {
    const localKey = firstStringArg(entry.args) ?? _name.toLowerCase();
    return magicBeesLang.get(`resource.${localKey}`) ?? titleWords(localKey).join(" ");
  },
});
const magicNuggetTypes = await enumItemProducts({
  file: "MagicBees/src/main/java/magicbees/item/types/NuggetType.java",
  enumName: "NuggetType",
  baseId: "MagicBees:beeNugget",
  labelFor: (name) =>
    magicBeesLang.get(`nugget.${name.toLowerCase()}`) ?? `${titleWords(name).join(" ")} Nugget`,
});
const gregtechCombs = await enumItemProducts({
  file: "GT5-Unofficial/src/main/java/gregtech/common/items/CombType.java",
  enumName: "CombType",
  baseId: "gregtech:gt.comb",
  metaFor: (entry, fallbackMeta) => numericArg(entry.args, 0) ?? fallbackMeta,
  labelFor: (_name, entry) => {
    const localKey = stringArg(entry.args, 1) ?? _name.toLowerCase();
    return `${titleWords(localKey).join(" ")} Comb`;
  },
});
const gregtechDrops = await enumItemProducts({
  file: "GT5-Unofficial/src/main/java/gregtech/common/items/DropType.java",
  enumName: "DropType",
  baseId: "gregtech:gt.drop",
  labelFor: (_name, entry) => {
    const localKey = firstStringArg(entry.args) ?? _name.toLowerCase();
    return `${titleWords(localKey).join(" ")} Drop`;
  },
});
const gregtechPropolis = await enumItemProducts({
  file: "GT5-Unofficial/src/main/java/gregtech/common/items/PropolisType.java",
  enumName: "PropolisType",
  baseId: "gregtech:gt.propolis",
  labelFor: (_name, entry) => {
    const localKey = firstStringArg(entry.args) ?? _name.toLowerCase();
    return `${titleWords(localKey).join(" ")} Propolis`;
  },
});
const gtppCustomCombs = await enumItemProducts({
  file: "GT5-Unofficial/src/main/java/gtPlusPlus/xmod/forestry/bees/custom/CustomCombs.java",
  enumName: "CustomCombs",
  baseId: "miscutils:gtpp.comb",
  labelFor: (_name, entry) => {
    const localKey = firstStringArg(entry.args) ?? _name.toLowerCase();
    return `${titleWords(localKey).join(" ")} Comb`;
  },
});
const gtppRegistryCombs = await enumItemProducts({
  file: "GT5-Unofficial/src/main/java/gtPlusPlus/xmod/forestry/bees/handler/GTPPCombType.java",
  enumName: "GTPPCombType",
  baseId: "miscutils:gtpp.comb",
  metaFor: (entry, fallbackMeta) => numericArg(entry.args, 0) ?? fallbackMeta,
  labelFor: (_name, entry) => {
    const label = stringArg(entry.args, 1) ?? _name;
    return `${titleWords(label).join(" ")} Comb`;
  },
});

const species = [];
await collectJavaEnumBeeSpecies({
  file: "ForestryMC/src/main/java/forestry/apiculture/genetics/BeeDefinition.java",
  enumName: "BeeDefinition",
  source: "Forestry",
  idPrefix: "forestry",
  displayNameFor: (entry) =>
    `${forestryLang.get(`for.bees.species.${entry.name.toLowerCase()}`) ?? titleWords(entry.name).join(" ")} Bee`,
});
await collectJavaEnumBeeSpecies({
  file: "Binnie/src/main/java/binnie/extrabees/genetics/ExtraBeeDefinition.java",
  enumName: "ExtraBeeDefinition",
  source: "ExtraBees",
  idPrefix: "extrabees",
  displayNameFor: (entry) =>
    `${extraBeesLang.get(`extrabees.species.${entry.name.toLowerCase()}.name`) ?? titleWords(entry.name).join(" ")} Bee`,
});
await collectMagicBeeSpecies();
await collectJavaEnumBeeSpecies({
  file: "GT5-Unofficial/src/main/java/gregtech/loaders/misc/GTBeeDefinition.java",
  enumName: "GTBeeDefinition",
  source: "GregTech",
  idPrefix: "gregtech",
  displayNameFor: (entry) => `${gregtechDisplayName(entry)} Bee`,
});
await collectJavaEnumBeeSpecies({
  file: "GT5-Unofficial/src/main/java/gtPlusPlus/xmod/forestry/bees/custom/GTPPBeeDefinition.java",
  enumName: "GTPPBeeDefinition",
  source: "GT++",
  idPrefix: "gtpp",
  displayNameFor: (entry) => `${stringArg(entry.args, 1) ?? titleWords(entry.name).join(" ")} Bee`,
});
await collectJavaEnumBeeSpecies({
  file: "GT5-Unofficial/src/main/java/gtPlusPlus/xmod/forestry/bees/registry/GTPP_BeeDefinition.java",
  enumName: "GTPP_BeeDefinition",
  source: "GT++",
  idPrefix: "gtpp",
  displayNameFor: (entry) => `${stringArg(entry.args, 1) ?? titleWords(entry.name).join(" ")} Bee`,
});
await collectAvaritiaBeeSpecies();

const catalog = {
  schemaVersion: 1,
  generatedFrom: "GTNH source bee species product declarations",
  baseCycleTicks: 550,
  productionFormula: "Forestry Bee.getFinalChance(chance, speed=1, productionModifier=-0.9, t=1)",
  species: mergeSpecies(species)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((entry) => ({
      ...entry,
      products: entry.products.sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          left.id.localeCompare(right.id) ||
          left.chance - right.chance,
      ),
    })),
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(`${outputPath}\n`.trim(), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${catalog.species.length} bee species to ${outputPath}.`);

async function collectJavaEnumBeeSpecies({ file, enumName, source, idPrefix, displayNameFor }) {
  const entries = enumEntries(await readText(file), enumName);
  for (const entry of entries) {
    const products = extractProductCalls(entry.text)
      .map((call) => productFromCall(call, source))
      .filter(Boolean);
    if (products.length === 0) {
      continue;
    }
    const displayName = displayNameFor(entry);
    species.push({
      id: `${idPrefix}:${slug(displayName.replace(/\s+Bee$/i, ""))}`,
      displayName,
      source,
      aliases: speciesAliases(entry, displayName),
      products,
    });
  }
}

async function collectMagicBeeSpecies() {
  const speciesFile = await readText("MagicBees/src/main/java/magicbees/bees/BeeSpecies.java");
  const productFile = await readText(
    "MagicBees/src/main/java/magicbees/bees/BeeProductHelper.java",
  );
  const entries = enumEntries(speciesFile, "BeeSpecies");
  const namesByEnum = new Map(
    entries.map((entry) => {
      const key = firstStringArg(entry.args) ?? titleWords(entry.name).join("");
      const displayName = magicBeesLang.get(`magicbees.species${key}`) ?? titleWords(key).join(" ");
      return [entry.name, `${displayName} Bee`];
    }),
  );
  const productsBySpecies = new Map();

  for (const statement of javaStatements(productFile)) {
    const receiverMatch =
      /(^|[^A-Za-z0-9_])([A-Z][A-Z0-9_]+)\s*\.add(?:Product|Specialty)\s*\(/.exec(statement);
    if (!receiverMatch) {
      continue;
    }
    const receiver = receiverMatch[2];
    const products = extractProductCalls(statement)
      .map((call) => productFromCall(call, "MagicBees"))
      .filter(Boolean);
    if (products.length === 0) {
      continue;
    }
    productsBySpecies.set(receiver, [...(productsBySpecies.get(receiver) ?? []), ...products]);
  }

  for (const [enumName, products] of productsBySpecies.entries()) {
    const displayName = namesByEnum.get(enumName) ?? `${titleWords(enumName).join(" ")} Bee`;
    species.push({
      id: `magicbees:${slug(displayName.replace(/\s+Bee$/i, ""))}`,
      displayName,
      source: "MagicBees",
      aliases: [enumName, displayName.replace(/\s+Bee$/i, "")],
      products,
    });
  }
}

async function collectAvaritiaBeeSpecies() {
  const file = await readText(
    "Avaritia/src/main/java/fox/spiteful/avaritia/compat/forestry/GreedyBeeSpecies.java",
  );
  const entries = enumEntries(file, "GreedyBeeSpecies");
  const displayByEnum = new Map(
    entries.map((entry) => {
      const key = firstStringArg(entry.args) ?? entry.name.toLowerCase();
      const displayName = avaritiaLang.get(`avaritia.bee.${key}`) ?? titleWords(key).join(" ");
      return [entry.name, `${displayName} Bee`];
    }),
  );
  const productsBySpecies = new Map();
  for (const statement of javaStatements(file)) {
    const receiverMatch =
      /(^|[^A-Za-z0-9_])(ANNOYING|TEDIOUS|INSUFFERABLE|TRIPPY|COSMIC|NEUTRONIUM|INFINITE)\s*\.add(?:Product|Specialty)\s*\(/.exec(
        statement,
      );
    if (!receiverMatch) {
      continue;
    }
    const receiver = receiverMatch[2];
    const products = extractProductCalls(statement)
      .map((call) => productFromCall(call, "Avaritia"))
      .filter(Boolean);
    if (products.length > 0) {
      productsBySpecies.set(receiver, [...(productsBySpecies.get(receiver) ?? []), ...products]);
    }
  }
  for (const [enumName, products] of productsBySpecies.entries()) {
    const displayName = displayByEnum.get(enumName) ?? `${titleWords(enumName).join(" ")} Bee`;
    species.push({
      id: `avaritia:${slug(displayName.replace(/\s+Bee$/i, ""))}`,
      displayName,
      source: "Avaritia",
      aliases: [enumName, displayName.replace(/\s+Bee$/i, "")],
      products,
    });
  }
}

function productFromCall(call, source) {
  const chance = numericLiteral(call.args[1]);
  if (!Number.isFinite(chance) || chance <= 0) {
    return undefined;
  }
  const product = resolveProduct(call.args[0], source);
  return {
    ...product,
    chance,
    role: call.kind === "Specialty" ? "specialty" : "product",
  };
}

function resolveProduct(expression, source) {
  const expr = expression.replace(/\s+/g, " ").trim();

  let match = /PluginApiculture\.items\.beeComb\.get\(EnumHoneyComb\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(forestryCombByName.get(match[1]));

  match = /ItemHoneyComb\.VanillaComb\.([A-Z0-9_]+)\.get\(\)/.exec(expr);
  if (match) return cloneProduct(vanillaCombByName.get(match[1]));

  match =
    /new ItemStack\(ForestryHelper\.beeComb,\s*1,\s*ForestryHelper\.Comb\.([A-Z0-9_]+)\.ordinal\(\)\)/.exec(
      expr,
    );
  if (match)
    return cloneProduct(forestryCombByName.get(match[1]) ?? vanillaCombByName.get(match[1]));

  if (/ForestryHelper\.itemHoneycomb/.test(expr))
    return cloneProduct(forestryCombByName.get("HONEY"));
  if (/getSlagComb\(\)/.test(expr)) return cloneProduct(gregtechCombs.byName.get("SLAG"));
  if (/getStoneComb\(\)/.test(expr)) return cloneProduct(gregtechCombs.byName.get("STONE"));

  match = /EnumHoneyComb\.([A-Z0-9_]+)\.get\(1\)/.exec(expr);
  if (match) return cloneProduct(extraBeesCombs.byName.get(match[1]));

  match = /GTBees\.combs\.getStackForType\(CombType\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(gregtechCombs.byName.get(match[1]));

  match = /GTBees\.drop\.getStackForType\(DropType\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(gregtechDrops.byName.get(match[1]));

  match = /GTBees\.propolis\.getStackForType\(PropolisType\.([A-Za-z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(gregtechPropolis.byName.get(match[1]));

  match = /GTPPBees\.combs\.getStackForType\(CustomCombs\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(gtppCustomCombs.byName.get(match[1]));

  match = /GTPP_Bees\.combs\.getStackForType\(GTPPCombType\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(gtppRegistryCombs.byName.get(match[1]));

  match = /Config\.combs\.getStackForType\(CombType\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(magicCombTypes.byName.get(match[1]));

  match = /Config\.drops\.getStackForType\(DropType\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(magicDropTypes.byName.get(match[1]));

  match = /Config\.pollen\.getStackForType\(PollenType\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(magicPollenTypes.byName.get(match[1]));

  match = /Config\.propolis\.getStackForType\(PropolisType\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(magicPropolisTypes.byName.get(match[1]));

  match = /Config\.nuggets\.getStackForType\(NuggetType\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(magicNuggetTypes.byName.get(match[1]));

  match = /Config\.miscResources\.getStackForType\(ResourceType\.([A-Z0-9_]+)/.exec(expr);
  if (match) return cloneProduct(magicResourceTypes.byName.get(match[1]));

  match = /GTModHandler\.getModItem\(([A-Za-z0-9_]+)\.ID,\s*"([^"]+)",\s*[^,]+,\s*([0-9]+)\)/.exec(
    expr,
  );
  if (match) {
    const modId = MOD_ID_ALIASES.get(match[1]) ?? match[1];
    const itemName = match[2];
    const meta = Number.parseInt(match[3], 10);
    const comb = productFromKnownModMeta(modId, itemName, meta);
    if (comb) return comb;
    return itemProduct(`${modId}:${itemName}`, meta, titleWords(itemName).join(" "));
  }

  match = /GTModHandler\.getIC2Item\("([^"]+)"/.exec(expr);
  if (match) return ic2Product(match[1]);

  match = /new ItemStack\((Items|Blocks)\.([A-Za-z0-9_]+)(?:,\s*[^,\)]+(?:,\s*([0-9]+))?)?\)/.exec(
    expr,
  );
  if (match) {
    const map = match[1] === "Items" ? VANILLA_ITEM_MAP : VANILLA_BLOCK_MAP;
    const entry = map.get(match[2]);
    if (entry) {
      const meta = match[3] !== undefined ? Number.parseInt(match[3], 10) : 0;
      return itemProduct(entry[0], meta, meta > 0 ? `${entry[1]} ${meta}` : entry[1]);
    }
  }

  match = /Mods\.forestry\.stack\("([^"]+)"\)/.exec(expr);
  if (match) return forestryNamedProduct(match[1]);

  if (/PluginApiculture\.items\.royalJelly\.getItemStack/.test(expr)) {
    return itemProduct("Forestry:royalJelly", 0, "Royal Jelly");
  }
  if (/PluginApiculture\.items\.pollenCluster\.get/.test(expr)) {
    return itemProduct("Forestry:pollen", 0, "Pollen");
  }
  if (/PluginCore\.items\.getAsh/.test(expr)) {
    return itemProduct("Forestry:ash", 0, "Ash");
  }
  if (/PluginCore\.items\.craftingMaterial\.getIceShard/.test(expr)) {
    return virtualProduct("Ice Shard", expr);
  }
  if (/PluginCore\.items\.peat\.getItemStack/.test(expr)) {
    return itemProduct("Forestry:peat", 0, "Peat");
  }

  match = /ArsMagicaHelper\.EssenceType\.([A-Z0-9_]+)\.ordinal\(\)/.exec(expr);
  if (match) return virtualProduct(`${titleWords(match[1]).join(" ")} Essence`, expr);

  match = /ArsMagicaHelper\.ResourceType\.([A-Z0-9_]+)\.ordinal\(\)/.exec(expr);
  if (match) return virtualProduct(titleWords(match[1]).join(" "), expr);

  if (/new ItemStack\(Config\.jellyBaby/.test(expr)) {
    return itemProduct("MagicBees:jellyBabies", 0, "Handful of Jelly Babies");
  }

  if (expr === "petal") {
    return virtualProduct("Botania Petal", expr);
  }

  if (/ForestryHelper\.Pollen\.CRYSTALLINE\.ordinal\(\)/.test(expr)) {
    return virtualProduct("Crystalline Pollen", expr);
  }

  if (/ForestryHelper\.Propolis\.STICKY\.ordinal\(\)/.test(expr)) {
    return virtualProduct("Sticky Propolis", expr);
  }

  if (/ForestryHelper\.CraftingMaterial\.SILK_WISP\.ordinal\(\)/.test(expr)) {
    return virtualProduct("Silk Wisp", expr);
  }

  if (/RedstoneArsenalHelper\.fluxNugget/.test(expr)) {
    return virtualProduct("Fluxed Electrum Nugget", expr);
  }

  if (/BotaniaHelper\.itemPastureSeed/.test(expr)) {
    return virtualProduct("Pasture Seed", expr);
  }

  if (/EquivalentExchangeHelper\.minuimShard/.test(expr)) {
    return virtualProduct("Minium Shard", expr);
  }

  match = /LudicrousItems\.combs,\s*1,\s*([0-9]+)/.exec(expr);
  if (match) {
    const meta = Number.parseInt(match[1], 10);
    return itemProduct(
      "Avaritia:Combs",
      meta,
      avaritiaLang.get(
        meta === 0 ? "item.avaritia.comb.nerfed.name" : "item.avaritia.comb.cosmic.name",
      ) ?? (meta === 0 ? "Nerfed Comb" : "Cosmic Comb"),
    );
  }
  match = /LudicrousItems\.beesource,\s*1,\s*([0-9]+)/.exec(expr);
  if (match) {
    const meta = Number.parseInt(match[1], 10);
    return itemProduct(
      "Avaritia:Beesource",
      meta,
      avaritiaLang.get(
        meta === 0
          ? "item.avaritia_beesource.infinity_drop.name"
          : "item.avaritia_beesource.dust.name",
      ) ?? (meta === 0 ? "Infinity Drop" : "Dust"),
    );
  }
  match = /LudicrousItems\.resource,\s*1,\s*([0-9]+)/.exec(expr);
  if (match) {
    const meta = Number.parseInt(match[1], 10);
    const labels = [
      "Diamond Lattice",
      "Crystal Matrix Ingot",
      "Pile of Cosmic Neutrons",
      "Cosmic Neutronium Nugget",
    ];
    return itemProduct("Avaritia:Resource", meta, labels[meta] ?? `Avaritia Resource ${meta}`);
  }

  match = /ItemList\.([A-Za-z0-9_]+)\.get/.exec(expr);
  if (match) return itemListProduct(match[1]);

  match = /Materials\.([A-Za-z0-9_]+)\.get(Dust|Dusts|Nuggets|Gems|Plates|Cells)\(/.exec(expr);
  if (match) {
    const suffix = materialProductSuffix(match[2]);
    return virtualProduct(`${titleWords(match[1]).join(" ")} ${suffix}`, expr);
  }

  match =
    /GTOreDictUnificator\.get\(OrePrefixes\.([A-Za-z0-9_]+),\s*Materials\.([A-Za-z0-9_]+)/.exec(
      expr,
    );
  if (match)
    return virtualProduct(`${orePrefixLabel(match[1])} ${titleWords(match[2]).join(" ")}`, expr);

  match = /OreDictionary\.getOres\("([^"]+)"/.exec(expr);
  if (match) return virtualProduct(titleWords(match[1]).join(" "), expr);

  match = /ThermalModsHelper\.([A-Za-z0-9_]+)/.exec(expr);
  if (match) return virtualProduct(titleWords(match[1]).join(" "), expr);

  match = /ThaumcraftHelper\.([A-Za-z0-9_]+)/.exec(expr);
  if (match) return virtualProduct(titleWords(match[1]).join(" "), expr);

  match = /AppliedEnergisticsHelper\.([A-Za-z0-9_]+)/.exec(expr);
  if (match) return virtualProduct(titleWords(match[1]).join(" "), expr);

  match = /BotaniaHelper\.([A-Za-z0-9_]+)/.exec(expr);
  if (match) return virtualProduct(titleWords(match[1]).join(" "), expr);

  match = /WerkstoffMaterialPool\.([A-Za-z0-9_]+)\.get\(OrePrefixes\.([A-Za-z0-9_]+)/.exec(expr);
  if (match)
    return virtualProduct(`${orePrefixLabel(match[2])} ${titleWords(match[1]).join(" ")}`, expr);

  return virtualProduct(`${source} Bee Product`, expr);
}

function productFromKnownModMeta(modId, itemName, meta) {
  if (modId === "Forestry" && itemName === "beeCombs")
    return cloneProduct(forestryCombByMeta.get(meta));
  if (modId === "ExtraBees" && itemName === "honeyComb")
    return cloneProduct(extraBeesCombs.byMeta.get(meta));
  if (modId === "MagicBees" && itemName === "comb")
    return cloneProduct(magicCombTypes.byMeta.get(meta));
  if (modId === "MagicBees" && itemName === "miscResources")
    return cloneProduct(magicResourceTypes.byMeta.get(meta));
  if (modId === "Forestry" && itemName === "peat")
    return itemProduct("Forestry:peat", meta, "Peat");
  if (modId === "Forestry" && itemName === "mulch")
    return itemProduct("Forestry:mulch", meta, "Mulch");
  if (modId === "BiomesOPlenty" && itemName === "mudball")
    return itemProduct("BiomesOPlenty:mudball", meta, "Mud Ball");
  if (modId === "TConstruct" && itemName === "strangeFood")
    return itemProduct("TConstruct:strangeFood", meta, "Strange Food");
  if (modId === "TConstruct" && itemName === "slime.gel")
    return itemProduct("TConstruct:slime.gel", meta, "Slime Gel");
  if (modId === "dreamcraft" && /StoneDust$/.test(itemName)) {
    return virtualProduct(
      `${titleWords(itemName.replace(/StoneDust$/, "")).join(" ")} Stone Dust`,
      `${modId}:${itemName}@${meta}`,
    );
  }
  if (modId === "dreamcraft" && /IceDust$/.test(itemName)) {
    return virtualProduct(
      `${titleWords(itemName.replace(/IceDust$/, "")).join(" ")} Ice Dust`,
      `${modId}:${itemName}@${meta}`,
    );
  }
  return undefined;
}

function ic2Product(name) {
  const known = new Map([["industrialTnt", ["IC2:blockITNT", "Industrial TNT"]]]);
  const entry = known.get(name);
  return entry
    ? itemProduct(entry[0], 0, entry[1])
    : itemProduct(`IC2:${name}`, 0, titleWords(name).join(" "));
}

function forestryNamedProduct(name) {
  const known = new Map([
    ["pollen", ["Forestry:pollen", "Pollen"]],
    ["pollenFertile", ["Forestry:pollenFertile", "Fertile Pollen"]],
  ]);
  const entry = known.get(name);
  return entry
    ? itemProduct(entry[0], 0, entry[1])
    : itemProduct(`Forestry:${name}`, 0, titleWords(name).join(" "));
}

function itemListProduct(name) {
  const known = new Map([
    ["IC2_Resin", ["IC2:itemHarz", "Sticky Resin"]],
    ["FR_Fertilizer", ["Forestry:fertilizerBio", "Forestry Fertilizer"]],
    ["IC2_Fertilizer", ["IC2:itemFertilizer", "Fertilizer"]],
  ]);
  const entry = known.get(name);
  return entry
    ? itemProduct(entry[0], 0, entry[1])
    : virtualProduct(titleWords(name.replace(/_/g, " ")).join(" "), name);
}

function materialProductSuffix(methodName) {
  switch (methodName) {
    case "Nuggets":
      return "Nugget";
    case "Gems":
      return "Gem";
    case "Plates":
      return "Plate";
    case "Cells":
      return "Cell";
    default:
      return "Dust";
  }
}

function orePrefixLabel(prefix) {
  const known = new Map([
    ["dust", "Dust"],
    ["dustTiny", "Tiny Dust"],
    ["gem", "Gem"],
    ["nugget", "Nugget"],
  ]);
  return known.get(prefix) ?? titleWords(prefix).join(" ");
}

function cloneProduct(product) {
  if (!product) {
    return undefined;
  }
  return { ...product };
}

function itemProduct(baseId, meta, displayName) {
  const normalizedMeta = Number.isFinite(meta) ? meta : 0;
  return {
    kind: "item",
    id: normalizedMeta > 0 ? `${baseId}@${normalizedMeta}` : baseId,
    displayName,
  };
}

function virtualProduct(displayName, sourceExpression) {
  const label = displayName && displayName !== "Bee Product" ? displayName : "Bee Product";
  return {
    kind: "item",
    id: `factoryflow:bee_product:${slug(`${label}:${sourceExpression}`)}`,
    displayName: label,
    tooltip: [`Source expression: ${sourceExpression.slice(0, 140)}`],
  };
}

async function enumItemProducts({ file, enumName, baseId, metaFor, labelFor }) {
  const entries = enumEntries(await readText(file), enumName);
  const byName = new Map();
  const byMeta = new Map();
  entries.forEach((entry, index) => {
    const meta = metaFor?.(entry, index) ?? index;
    const product = itemProduct(baseId, meta, labelFor(entry.name, entry, index));
    byName.set(entry.name, product);
    byMeta.set(meta, product);
  });
  return { byName, byMeta };
}

function extractProductCalls(text) {
  const calls = [];
  let index = 0;
  const pattern = /\.add(Product|Specialty)\s*\(/g;
  while (index < text.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (!match) {
      break;
    }
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatching(text, openIndex, "(", ")");
    if (closeIndex < 0) {
      break;
    }
    const args = splitTopLevel(text.slice(openIndex + 1, closeIndex), ",");
    calls.push({ kind: match[1], args });
    index = closeIndex + 1;
  }
  return calls;
}

function mergeSpecies(entries) {
  const byId = new Map();
  for (const entry of entries) {
    const current = byId.get(entry.id);
    if (!current) {
      byId.set(entry.id, {
        ...entry,
        aliases: unique(entry.aliases ?? []),
        products: uniqueProducts(entry.products),
      });
      continue;
    }
    current.aliases = unique([...(current.aliases ?? []), ...(entry.aliases ?? [])]);
    current.products = uniqueProducts([...current.products, ...entry.products]);
  }
  return [...byId.values()];
}

function uniqueProducts(products) {
  const seen = new Set();
  const result = [];
  for (const product of products) {
    const key = `${product.kind}:${product.id}:${product.chance}:${product.role}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(product);
  }
  return result;
}

function speciesAliases(entry, displayName) {
  return unique(
    [entry.name, displayName.replace(/\s+Bee$/i, ""), firstStringArg(entry.args)].filter(Boolean),
  );
}

function gregtechDisplayName(entry) {
  const args = splitTopLevel(entry.args, ",");
  const locName = args.length > 3 && /^"[^"]+"/.test(args[2] ?? "") ? unquote(args[2]) : undefined;
  return locName ?? titleWords(entry.name).join(" ");
}

function enumEntries(source, enumName) {
  const text = stripJavaComments(source);
  const enumIndex = text.search(new RegExp(`\\benum\\s+${enumName}\\b`));
  if (enumIndex < 0) {
    throw new Error(`Could not find enum ${enumName}`);
  }
  const openIndex = text.indexOf("{", enumIndex);
  const constants = [];
  let start = openIndex + 1;
  let depth = 1;
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote;

  for (let index = openIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth -= 1;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth -= 1;
      continue;
    }
    if (depth === 1 && parenDepth === 0 && bracketDepth === 0 && (char === "," || char === ";")) {
      const chunk = text.slice(start, index).trim();
      const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|\{|$)/.exec(chunk);
      if (nameMatch) {
        constants.push(parseEnumEntry(nameMatch[1], chunk));
      }
      start = index + 1;
      if (char === ";") {
        break;
      }
    }
  }
  return constants;
}

function parseEnumEntry(name, text) {
  const argsStart = text.indexOf("(", name.length);
  if (argsStart < 0) {
    return { name, args: "", text };
  }
  const argsEnd = findMatching(text, argsStart, "(", ")");
  return { name, args: argsEnd > argsStart ? text.slice(argsStart + 1, argsEnd) : "", text };
}

function javaStatements(source) {
  const text = stripJavaComments(source);
  const statements = [];
  let start = 0;
  let parenDepth = 0;
  let quote;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === ";" && parenDepth === 0) {
      statements.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  return statements;
}

function splitTopLevel(value, separator) {
  const parts = [];
  let start = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (char === separator && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function findMatching(text, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function stripJavaComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function firstStringArg(argsText) {
  return stringArg(argsText, 0);
}

function stringArg(argsText, index) {
  const value = splitTopLevel(argsText, ",")[index]?.trim();
  return unquote(value);
}

function numericArg(argsText, index) {
  return numericLiteral(splitTopLevel(argsText, ",")[index]);
}

function numericLiteral(value) {
  const match = /^\s*([0-9]*\.?[0-9]+)\s*[fFdDlL]?\s*$/.exec(value ?? "");
  return match ? Number.parseFloat(match[1]) : undefined;
}

function unquote(value) {
  const match = /^"([^"]*)"$/.exec(value?.trim() ?? "");
  return match?.[1];
}

async function readText(relativePath) {
  return fs.readFile(path.join(sourceRoot, ...relativePath.split("/")), "utf8");
}

async function readLang(relativePath) {
  const lines = (await readText(relativePath)).split(/\r?\n/);
  const map = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    map.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return map;
}

function titleWords(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
