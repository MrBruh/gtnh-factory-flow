import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = process.argv[2];
if (!repoDir) {
  throw new Error("Usage: patch-recex-autorun.mjs <RecEx checkout>");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const iconExporterTemplateDir = path.join(
  scriptDir,
  "..",
  "icon-exporter-1.7.10",
  "src",
  "main",
  "java",
);

const modPath = path.join(repoDir, "src/main/java/com/bigbass/recex/RecipeExporterMod.java");
let source = await fs.readFile(modPath, "utf8");

source = source.replace(
  "import com.bigbass.recex.proxy.CommonProxy;",
  [
    "import com.bigbass.recex.proxy.CommonProxy;",
    "import com.bigbass.recex.icons.ClientItemStackIconRenderer;",
    "import com.bigbass.recex.recipes.RecipeExporter;",
    "",
    "import cpw.mods.fml.common.FMLCommonHandler;",
    "import cpw.mods.fml.common.event.FMLLoadCompleteEvent;",
    "import cpw.mods.fml.common.event.FMLServerStartedEvent;",
    "import cpw.mods.fml.common.eventhandler.SubscribeEvent;",
    "import cpw.mods.fml.common.gameevent.TickEvent;",
    "import net.minecraft.client.Minecraft;",
    "",
    "import java.lang.reflect.Method;",
    "import java.util.concurrent.atomic.AtomicBoolean;",
  ].join("\n"),
);

source = source.replace(
  "    public static RecipeExporterMod instance;\n",
  [
    "    public static RecipeExporterMod instance;",
    "    private static final AtomicBoolean autorunStarted = new AtomicBoolean(false);",
    "",
  ].join("\n"),
);

if (!source.includes("requestAutorunExport")) {
  source = source.replace(
    /\s+@Mod\.EventHandler\s+public void init\(FMLInitializationEvent e\)\s*\{\s*proxy\.init\(e\);\s*\}\s*(?:@Mod\.EventHandler[\s\S]*?)?\n\}/,
    `

    @Mod.EventHandler
    public void init(FMLInitializationEvent e) {
        proxy.init(e);
        if (Boolean.getBoolean("recex.autorun") && FMLCommonHandler.instance().getSide().isClient()) {
            log.info("RecEx autorun registering mod event handler.");
            FMLCommonHandler.instance().bus().register(this);
            if (!Boolean.getBoolean("recex.renderIcons")) {
                startDelayedClientAutorunThread();
            }
        }
    }

    @Mod.EventHandler
    public void serverStarted(FMLServerStartedEvent e) {
        if (FMLCommonHandler.instance().getSide().isClient() && !Boolean.getBoolean("recex.renderIcons")) {
            return;
        }

        runAutorunExport("server-started");
    }

    @Mod.EventHandler
    public void loadComplete(FMLLoadCompleteEvent e) {
        if (!FMLCommonHandler.instance().getSide().isClient()) {
            return;
        }

        if (Boolean.getBoolean("recex.renderIcons")) {
            return;
        }

        runAutorunExport("client-load-complete");
    }

    @SubscribeEvent
    public void clientTick(TickEvent.ClientTickEvent e) {
        if (e.phase != TickEvent.Phase.END || !FMLCommonHandler.instance().getSide().isClient()) {
            return;
        }

        if (Boolean.getBoolean("recex.renderIcons")) {
            return;
        }

        runAutorunExport("client-tick");
    }

    public static void requestAutorunExport(String trigger) {
        runAutorunExport(trigger);
    }

    private static void startDelayedClientAutorunThread() {
        Thread thread = new Thread(() -> {
            try {
                Thread.sleep(Long.getLong("recex.autorunDelayMillis", 90000L));
                Minecraft minecraft = Minecraft.getMinecraft();
                if (minecraft == null) {
                    runAutorunExport("client-delayed-thread");
                    return;
                }

                Method method = minecraft.getClass().getMethod("func_152344_a", Runnable.class);
                method.invoke(minecraft, new Runnable() {
                    @Override
                    public void run() {
                        runAutorunExport("client-delayed-task");
                    }
                });
            } catch (Throwable t) {
                log.error("RecEx delayed autorun scheduling failed.", t);
                FMLCommonHandler.instance().exitJava(2, false);
            }
        });
        thread.setDaemon(true);
        thread.setName("recex-delayed-autorun-scheduler");
        thread.start();
    }

    private static void runAutorunExport(String trigger) {
        if (!Boolean.getBoolean("recex.autorun")) {
            return;
        }

        if (!autorunStarted.compareAndSet(false, true)) {
            return;
        }

        Runnable task = () -> {
            try {
                log.info("RecEx autorun export started from " + trigger + ".");
                RecipeExporter.getInst().run();
                log.info("RecEx autorun recipe export finished.");
            } catch (Throwable t) {
                log.error("RecEx autorun export failed.", t);
                FMLCommonHandler.instance().exitJava(2, false);
                return;
            }

            if (Boolean.getBoolean("recex.renderIcons") && FMLCommonHandler.instance().getSide().isClient()) {
                ClientItemStackIconRenderer.exportQueuedIconsThen(new Runnable() {
                    @Override
                    public void run() {
                        log.info("RecEx autorun export finished.");
                        FMLCommonHandler.instance().exitJava(0, false);
                    }
                });
                return;
            }

            log.info("RecEx autorun export finished.");
            FMLCommonHandler.instance().exitJava(0, false);
        };

        if (Boolean.getBoolean("recex.renderIcons") && FMLCommonHandler.instance().getSide().isClient()) {
            task.run();
            return;
        }

        Thread thread = new Thread(task);
        thread.setDaemon(false);
        thread.setName("recex-autorun-export");
        thread.start();
    }
}`,
  );
}

await fs.writeFile(modPath, source);

const clientProxyPath = path.join(
  repoDir,
  "src/main/java/com/bigbass/recex/proxy/ClientProxy.java",
);
let clientProxySource = await fs.readFile(clientProxyPath, "utf8");
clientProxySource = clientProxySource.replace(
  "import com.bigbass.recex.KeyBindings;",
  [
    "import com.bigbass.recex.KeyBindings;",
    "import com.bigbass.recex.autorun.ClientAutorunExportHandler;",
  ].join("\n"),
);
clientProxySource = clientProxySource.replace(
  "        KeyBindings.getInstance();\n",
  [
    "        KeyBindings.getInstance();",
    '        if (Boolean.getBoolean("recex.autorun")) {',
    "            FMLCommonHandler.instance().bus().register(new ClientAutorunExportHandler());",
    "        }",
  ].join("\n") + "\n",
);
await fs.writeFile(clientProxyPath, clientProxySource);

const autorunPackageDir = path.join(repoDir, "src/main/java/com/bigbass/recex/autorun");
await fs.mkdir(autorunPackageDir, { recursive: true });
await copyIconExporterTemplate(
  "com/bigbass/recex/autorun/ClientAutorunExportHandler.java",
  path.join(autorunPackageDir, "ClientAutorunExportHandler.java"),
);

const exporterPath = path.join(
  repoDir,
  "src/main/java/com/bigbass/recex/recipes/RecipeExporter.java",
);
let exporterSource = await fs.readFile(exporterPath, "utf8");

if (!exporterSource.includes("import java.lang.reflect.Method;")) {
  exporterSource = exporterSource.replace(
    "import java.lang.reflect.Field;\n",
    "import java.lang.reflect.Field;\nimport java.lang.reflect.Method;\n",
  );
}
if (!exporterSource.includes("import java.util.HashMap;")) {
  exporterSource = exporterSource.replace(
    "import java.util.List;\n",
    "import java.util.HashMap;\nimport java.util.List;\n",
  );
}
if (!exporterSource.includes("import java.util.Map;")) {
  exporterSource = exporterSource.replace(
    "import java.util.List;\n",
    "import java.util.List;\nimport java.util.Map;\n",
  );
}
exporterSource = exporterSource.replace(
  "import gregtech.api.recipe.RecipeMap;",
  [
    "import codechicken.nei.PositionedStack;",
    "import codechicken.nei.recipe.RecipeCatalysts;",
    "import codechicken.nei.recipe.GuiCraftingRecipe;",
    "import codechicken.nei.recipe.GuiUsageRecipe;",
    "import codechicken.nei.recipe.TemplateRecipeHandler;",
    "import com.gtnewhorizons.modularui.api.math.Pos2d;",
    "import gregtech.api.GregTechAPI;",
    "import gregtech.api.recipe.BasicUIProperties;",
    "import gregtech.api.recipe.RecipeMap;",
    "import net.minecraft.item.ItemStack;",
    "import net.minecraft.util.EnumChatFormatting;",
  ].join("\n"),
);
if (!exporterSource.includes("neiCatalystsLoaded")) {
  exporterSource = exporterSource.replace(
    "    private static RecipeExporter instance;\n",
    "    private static RecipeExporter instance;\n    private static boolean neiCatalystsLoaded = false;\n",
  );
}

exporterSource = exporterSource.replace(
  "        out.mInputChances = recipe.mInputChances;\n",
  [
    "        // GTNH stable 2.8.x runtime GregTech does not expose mInputChances.",
    "        // Keep the exporter compatible with both stable and newer daily builds.",
  ].join("\n") + "\n",
);

exporterSource = exporterSource.replace(
  "        out.mOutputs = clean(recipe.mOutputs);\n",
  [
    "        out.mOutputs = cleanPreserveOrder(recipe.mOutputs);",
    "        setOutputChances(out, compactOutputChances(recipe, recipe.mOutputs));",
  ].join("\n") + "\n",
);
exporterSource = exporterSource.replace(
  "        out.mInputs = clean(recipe.mInputs);\n",
  "        out.mInputs = cleanPreserveOrder(recipe.mInputs);\n",
);
exporterSource = exporterSource.replace(
  "        out.mFluidInputs = clean(recipe.mFluidInputs);\n",
  "        out.mFluidInputs = cleanPreserveOrder(recipe.mFluidInputs);\n",
);
exporterSource = exporterSource.replace(
  "        out.mFluidOutputs = clean(recipe.mFluidOutputs);\n",
  "        out.mFluidOutputs = cleanPreserveOrder(recipe.mFluidOutputs);\n",
);
exporterSource = exporterSource.replace(
  "                .map(RecipeExporter::cloneAndSort)\n                .sorted(COMPARE_RECIPE)",
  "                .sorted(COMPARE_RECIPE)",
);

exporterSource = exporterSource.replace(
  [
    "        List<RecipeMap<RecipeMapBackend>> maps = new ArrayList<>();",
    "        List<Class<?>> recipeMapClasses = Arrays.asList(",
    "            RecipeMaps.class,",
    "            GTPPRecipeMaps.class,",
    "            BartWorksRecipeMaps.class,",
    "            GoodGeneratorRecipeMaps.class,",
    "            TecTechRecipeMaps.class);",
    "",
    "        for (Class<?> recipeMapClass : recipeMapClasses) {",
    "            for (Field field : recipeMapClass.getDeclaredFields()) {",
    "                if (field.getType() == RecipeMap.class) {",
    "                    try {",
    "                        maps.add((RecipeMap<RecipeMapBackend>) field.get(null));",
    "                    } catch (IllegalArgumentException | IllegalAccessException e) {",
    "                        e.printStackTrace();",
    "                    }",
    "                }",
    "            }",
    "        }",
  ].join("\n"),
  [
    "        List<RecipeMap<RecipeMapBackend>> maps = new ArrayList<>();",
    "        for (RecipeMap<?> recipeMap : RecipeMap.ALL_RECIPE_MAPS.values()) {",
    "            try {",
    "                maps.add((RecipeMap<RecipeMapBackend>) recipeMap);",
    "            } catch (ClassCastException ignored) {",
    "                // Some addon maps use custom backend generics, but RecEx only needs common recipe data.",
    "            }",
    "        }",
  ].join("\n"),
);

exporterSource = exporterSource.replace(
  '            RecipeExporterMod.log.info("Processing recipe map " + mach.n);\n',
  [
    "            mach.nei = map.getFrontend().getUIProperties().neiTransferRectId;",
    "            mach.cat = getNeiCatalysts(mach.nei);",
    "            addMultiblockMachineCatalysts(mach.cat, map);",
    "            mach.handlers = getNeiRecipeHandlers(mach.nei);",
    "",
    '            RecipeExporterMod.log.info("Processing recipe map " + mach.n);',
  ].join("\n") + "\n",
);

exporterSource = exporterSource.replace(
  '        temp.put("type", "shaped");\n        temp.put("recipes", shapedRecies);',
  '        temp.put("type", "shaped");\n        temp.put("recipes", shapedRecies);\n        temp.put("catalysts", getNeiCatalysts("crafting"));\n        temp.put("handlers", getNeiRecipeHandlers("crafting"));',
);
exporterSource = exporterSource.replace(
  '        temp.put("type", "shapeless");\n        temp.put("recipes", shapelessRecipes);',
  '        temp.put("type", "shapeless");\n        temp.put("recipes", shapelessRecipes);\n        temp.put("catalysts", getNeiCatalysts("crafting"));\n        temp.put("handlers", getNeiRecipeHandlers("crafting"));',
);
exporterSource = exporterSource.replace(
  '        temp.put("type", "shapedOreDict");\n        temp.put("recipes", oredictShapedRecipes);',
  '        temp.put("type", "shapedOreDict");\n        temp.put("recipes", oredictShapedRecipes);\n        temp.put("catalysts", getNeiCatalysts("crafting"));\n        temp.put("handlers", getNeiRecipeHandlers("crafting"));',
);
if (!exporterSource.includes("getPassiveNeiRecipes()")) {
  exporterSource = exporterSource.replace(
    "        return sources;\n",
    [
      "        Map<String, Object> passiveNeiRecipes = getPassiveNeiRecipes();",
      "        if (passiveNeiRecipes != null) {",
      "            sources.add(passiveNeiRecipes);",
      "        }",
      "",
      "        return sources;",
    ].join("\n") + "\n",
  );
}

exporterSource = exporterSource.replace(
  "\n    private static FluidStack[] clean(FluidStack[] stacks) {",
  [
    "",
    "    private static ItemStack[] cleanPreserveOrder(ItemStack[] stacks) {",
    "        int len = 0;",
    "",
    "        for (int i = 0; i < stacks.length; i++) {",
    "            if (stacks[i] != null) len++;",
    "        }",
    "",
    "        ItemStack[] out = new ItemStack[len];",
    "        int next = 0;",
    "",
    "        for (int i = 0; i < stacks.length; i++) {",
    "            ItemStack x = stacks[i];",
    "",
    "            if (x != null) {",
    "                out[next++] = x.copy();",
    "            }",
    "        }",
    "",
    "        return out;",
    "    }",
    "",
    "    private static FluidStack[] cleanPreserveOrder(FluidStack[] stacks) {",
    "        int len = 0;",
    "",
    "        for (int i = 0; i < stacks.length; i++) {",
    "            if (stacks[i] != null) len++;",
    "        }",
    "",
    "        FluidStack[] out = new FluidStack[len];",
    "        int next = 0;",
    "",
    "        for (int i = 0; i < stacks.length; i++) {",
    "            FluidStack x = stacks[i];",
    "",
    "            if (x != null) {",
    "                out[next++] = x.copy();",
    "            }",
    "        }",
    "",
    "        return out;",
    "    }",
    "",
    "    private static FluidStack[] clean(FluidStack[] stacks) {",
  ].join("\n"),
);

exporterSource = exporterSource.replace(
  "                // item inputs\n",
  [
    "                // item inputs",
    "                int[] inputChances = getInputChances(rec, rec.mInputs.length);",
    "                int inputIndex = 0;",
  ].join("\n") + "\n",
);

exporterSource = exporterSource.replace(
  "                    if (item == null) {\n                        continue;\n                    }\n",
  [
    "                    if (item == null) {",
    "                        inputIndex++;",
    "                        continue;",
    "                    }",
  ].join("\n") + "\n",
);

exporterSource = exporterSource.replace(
  "                    gtr.iI.add(item);\n",
  [
    "                    if (inputChances != null && inputIndex < inputChances.length && inputChances[inputIndex] <= 0) {",
    "                        item.nc = Boolean.TRUE;",
    "                    }",
    "                    inputIndex++;",
    "",
    "                    item.sl = Integer.valueOf(inputIndex - 1);",
    "                    gtr.iI.add(item);",
  ].join("\n") + "\n",
);

exporterSource = exporterSource.replace(
  "                // item outputs\n",
  [
    "                // non-consumed item inputs / special items",
    "                if (rec.mSpecialItems != null) {",
    "                    if (rec.mSpecialItems instanceof ItemStack) {",
    "                        Item item = RecipeUtil.formatGregtechItemStack((ItemStack) rec.mSpecialItems);",
    "                        if (item != null) {",
    "                            item.sl = Integer.valueOf(GregtechRecipe.SPECIAL_SLOT_INDEX);",
    "                            gtr.iNC.add(item);",
    "                        }",
    "                    } else if (rec.mSpecialItems instanceof Object[]) {",
    "                        for (Object special : (Object[]) rec.mSpecialItems) {",
    "                            if (!(special instanceof ItemStack)) continue;",
    "                            Item item = RecipeUtil.formatGregtechItemStack((ItemStack) special);",
    "                            if (item != null) {",
    "                                item.sl = Integer.valueOf(GregtechRecipe.SPECIAL_SLOT_INDEX);",
    "                                gtr.iNC.add(item);",
    "                            }",
    "                        }",
    "                    } else if (rec.mSpecialItems instanceof Iterable) {",
    "                        for (Object special : (Iterable<?>) rec.mSpecialItems) {",
    "                            if (!(special instanceof ItemStack)) continue;",
    "                            Item item = RecipeUtil.formatGregtechItemStack((ItemStack) special);",
    "                            if (item != null) {",
    "                                item.sl = Integer.valueOf(GregtechRecipe.SPECIAL_SLOT_INDEX);",
    "                                gtr.iNC.add(item);",
    "                            }",
    "                        }",
    "                    }",
    "                }",
    "",
    "                // item outputs",
    "                int outputIndex = 0;",
  ].join("\n") + "\n",
);

exporterSource = exporterSource.replace(
  "                    gtr.iO.add(item);\n",
  [
    "                    int outputChance = rec.getOutputChance(outputIndex);",
    "                    if (outputChance > 0 && outputChance < 10000) {",
    "                        item.ch = Integer.valueOf(outputChance);",
    "                    }",
    "                    outputIndex++;",
    "",
    "                    item.sl = Integer.valueOf(outputIndex - 1);",
    "                    gtr.iO.add(item);",
  ].join("\n") + "\n",
);

if (!exporterSource.includes("buildRuntimeCalculation(map, rec)")) {
  exporterSource = exporterSource.replace(
    "                if (rec.mSpecialValue != 0) gtr.sp = rec.mSpecialValue;\n",
    "                if (rec.mSpecialValue != 0) gtr.sp = rec.mSpecialValue;\n                addNeiSlots(gtr, map, rec);\n                gtr.rc = buildRuntimeCalculation(map, rec);\n",
  );
}

exporterSource = exporterSource.replace(
  "                // fluid inputs\n                for (FluidStack stack : rec.mFluidInputs) {\n",
  "                // fluid inputs\n                int fluidInputIndex = 0;\n                for (FluidStack stack : rec.mFluidInputs) {\n",
);
exporterSource = exporterSource.replace(
  "                    if (fluid == null) {\n                        continue;\n                    }\n\n                    gtr.fI.add(fluid);\n",
  [
    "                    if (fluid == null) {",
    "                        fluidInputIndex++;",
    "                        continue;",
    "                    }",
    "",
    "                    fluid.sl = Integer.valueOf(fluidInputIndex);",
    "                    fluidInputIndex++;",
    "                    gtr.fI.add(fluid);",
  ].join("\n") + "\n",
);
exporterSource = exporterSource.replace(
  "                // fluid outputs\n                for (FluidStack stack : rec.mFluidOutputs) {\n",
  "                // fluid outputs\n                int fluidOutputIndex = 0;\n                for (FluidStack stack : rec.mFluidOutputs) {\n",
);
exporterSource = exporterSource.replace(
  "                    if (fluid == null) {\n                        continue;\n                    }\n\n                    gtr.fO.add(fluid);\n",
  [
    "                    if (fluid == null) {",
    "                        fluidOutputIndex++;",
    "                        continue;",
    "                    }",
    "",
    "                    fluid.sl = Integer.valueOf(fluidOutputIndex);",
    "                    fluidOutputIndex++;",
    "                    gtr.fO.add(fluid);",
  ].join("\n") + "\n",
);

exporterSource = exporterSource.replace(
  [
    "                    if (item == null) {",
    "                        continue;",
    "                    }",
    "",
    "                    int outputChance = rec.getOutputChance(outputIndex);",
  ].join("\n"),
  [
    "                    if (item == null) {",
    "                        outputIndex++;",
    "                        continue;",
    "                    }",
    "",
    "                    int outputChance = rec.getOutputChance(outputIndex);",
  ].join("\n"),
);

exporterSource = exporterSource.replace(
  "\n    private List<ShapedRecipe> getShapedRecipes() {",
  [
    "",
    "    private static int[] getInputChances(Object recipe, int inputCount) {",
    '        int[] fieldChances = readIntArrayField(recipe, new String[] { "mInputChances", "mInputChance" });',
    "        if (fieldChances != null) {",
    "            return fieldChances;",
    "        }",
    "",
    '        return callChanceGetter(recipe, "getInputChance", inputCount);',
    "    }",
    "",
    "    private static int[] getOutputChances(Object recipe, int outputCount) {",
    '        int[] fieldChances = readIntArrayField(recipe, new String[] { "mOutputChances", "mChances", "mOutputChance" });',
    "        if (fieldChances != null) {",
    "            return fieldChances;",
    "        }",
    "",
    '        return callChanceGetter(recipe, "getOutputChance", outputCount);',
    "    }",
    "",
    "    private static int[] compactOutputChances(Object recipe, ItemStack[] outputs) {",
    "        int[] sourceChances = getOutputChances(recipe, outputs.length);",
    "        if (sourceChances == null) {",
    "            return null;",
    "        }",
    "",
    "        int len = 0;",
    "        for (int index = 0; index < outputs.length; index++) {",
    "            if (outputs[index] != null) {",
    "                len++;",
    "            }",
    "        }",
    "",
    "        int[] chances = new int[len];",
    "        int next = 0;",
    "        for (int index = 0; index < outputs.length; index++) {",
    "            if (outputs[index] != null) {",
    "                chances[next++] = index < sourceChances.length ? sourceChances[index] : 10000;",
    "            }",
    "        }",
    "        return chances;",
    "    }",
    "",
    "    private static void setOutputChances(Object recipe, int[] chances) {",
    "        if (recipe == null || chances == null) {",
    "            return;",
    "        }",
    '        writeIntArrayField(recipe, new String[] { "mOutputChances", "mChances", "mOutputChance" }, chances);',
    "    }",
    "",
    "    private static int[] readIntArrayField(Object target, String[] fieldNames) {",
    "        if (target == null) {",
    "            return null;",
    "        }",
    "",
    "        Class<?> type = target.getClass();",
    "        while (type != null) {",
    "            for (String fieldName : fieldNames) {",
    "                try {",
    "                    Field field = type.getDeclaredField(fieldName);",
    "                    field.setAccessible(true);",
    "                    Object value = field.get(target);",
    "                    if (value instanceof int[]) {",
    "                        return (int[]) value;",
    "                    }",
    "                } catch (NoSuchFieldException ignored) {",
    "                    // GTNH versions expose this under different names/classes.",
    "                } catch (IllegalAccessException ignored) {",
    "                    return null;",
    "                }",
    "            }",
    "            type = type.getSuperclass();",
    "        }",
    "",
    "        return null;",
    "    }",
    "",
    "    private static boolean writeIntArrayField(Object target, String[] fieldNames, int[] value) {",
    "        if (target == null) {",
    "            return false;",
    "        }",
    "",
    "        Class<?> type = target.getClass();",
    "        while (type != null) {",
    "            for (String fieldName : fieldNames) {",
    "                try {",
    "                    Field field = type.getDeclaredField(fieldName);",
    "                    field.setAccessible(true);",
    "                    field.set(target, value);",
    "                    return true;",
    "                } catch (NoSuchFieldException ignored) {",
    "                    // GTNH versions expose this under different names/classes.",
    "                } catch (IllegalAccessException ignored) {",
    "                    return false;",
    "                }",
    "            }",
    "            type = type.getSuperclass();",
    "        }",
    "",
    "        return false;",
    "    }",
    "",
    "    private static List<Item> getNeiCatalysts(String transferRectId) {",
    "        List<Item> catalysts = new ArrayList<Item>();",
    "        if (transferRectId == null || transferRectId.isEmpty()) {",
    "            return catalysts;",
    "        }",
    "        ensureNeiCatalystsLoaded();",
    "",
    "        try {",
    "            for (PositionedStack positionedStack : RecipeCatalysts.getRecipeCatalysts(transferRectId)) {",
    "                addCatalyst(catalysts, positionedStack);",
    "            }",
    "        } catch (Throwable ignored) {",
    "            // Keep RecEx compatible with runtimes where NEI did not expose this registry yet.",
    "        }",
    "",
    "        try {",
    "            for (Object rawHandler : GuiCraftingRecipe.craftinghandlers) {",
    "                if (rawHandler instanceof TemplateRecipeHandler && handlerMatchesTransferRect((TemplateRecipeHandler) rawHandler, transferRectId)) {",
    "                    for (PositionedStack positionedStack : RecipeCatalysts.getRecipeCatalysts((TemplateRecipeHandler) rawHandler)) {",
    "                        addCatalyst(catalysts, positionedStack);",
    "                    }",
    "                }",
    "            }",
    "        } catch (Throwable ignored) {",
    "            // Some NEI handler implementations throw while loading transfer rect metadata.",
    "        }",
    "",
    "        return catalysts;",
    "    }",
    "",
    "    private static void ensureNeiCatalystsLoaded() {",
    "        if (neiCatalystsLoaded) {",
    "            return;",
    "        }",
    "        neiCatalystsLoaded = true;",
    "        try {",
    "            RecipeCatalysts.loadCatalystInfo();",
    "        } catch (Throwable ignored) {",
    "            // Some packs/runtimes initialize this earlier or disable the catalyst CSV.",
    "        }",
    "    }",
    "",
    "    private static void addCatalyst(List<Item> catalysts, PositionedStack positionedStack) {",
    "        if (positionedStack == null || positionedStack.item == null) {",
    "            return;",
    "        }",
    "        Item item = RecipeUtil.formatRegularItemStack(positionedStack.item);",
    "        appendMetaTileEntityTooltip(item, getMetaTileEntityForStack(positionedStack.item));",
    "        if (item != null && !containsItem(catalysts, item)) {",
    "            catalysts.add(item);",
    "        }",
    "    }",
    "",
    "    private static void addMultiblockMachineCatalysts(List<Item> catalysts, RecipeMap<RecipeMapBackend> recipeMap) {",
    "        if (recipeMap == null || GregTechAPI.sBlockMachines == null) {",
    "            return;",
    "        }",
    "",
    "        try {",
    "            for (int meta = 1; meta < GregTechAPI.METATILEENTITIES.length; meta++) {",
    "                Object mte = GregTechAPI.METATILEENTITIES[meta];",
    "                if (!isMultiblockMetaTileEntity(mte) || !metaTileEntitySupportsRecipeMap(mte, recipeMap)) {",
    "                    continue;",
    "                }",
    "",
    "                Item item = RecipeUtil.formatRegularItemStack(new ItemStack(GregTechAPI.sBlockMachines, 1, meta));",
    "                appendMetaTileEntityTooltip(item, mte);",
    "                if (item != null && !containsItem(catalysts, item)) {",
    "                    catalysts.add(item);",
    "                }",
    "            }",
    "        } catch (Throwable ignored) {",
    "            // Some MetaTileEntities cannot be queried safely during export startup.",
    "        }",
    "    }",
    "",
    "    private static boolean isMultiblockMetaTileEntity(Object mte) {",
    "        Class<?> type = mte == null ? null : mte.getClass();",
    "        while (type != null) {",
    "            String name = type.getName();",
    '            if (name.equals("gregtech.api.metatileentity.implementations.MTEExtendedPowerMultiBlockBase")',
    '                || name.equals("gregtech.api.metatileentity.implementations.MTEMultiBlockBase")',
    '                || name.endsWith("MultiBlockBase")) {',
    "                return true;",
    "            }",
    "            type = type.getSuperclass();",
    "        }",
    "        return false;",
    "    }",
    "",
    "    private static boolean metaTileEntitySupportsRecipeMap(Object mte, RecipeMap<RecipeMapBackend> recipeMap) {",
    "        if (recipeMap == null) {",
    "            return false;",
    "        }",
    "",
    "        Object recipeMapValue = getMetaTileEntityRecipeMap(mte);",
    "        if (recipeMapValue == recipeMap) {",
    "            return true;",
    "        }",
    "",
    "        for (Object availableRecipeMap : getMetaTileEntityAvailableRecipeMaps(mte)) {",
    "            if (availableRecipeMap == recipeMap) {",
    "                return true;",
    "            }",
    "        }",
    "",
    "        return false;",
    "    }",
    "",
    "    private static List<Object> getMetaTileEntityAvailableRecipeMaps(Object mte) {",
    "        Class<?> type = mte == null ? null : mte.getClass();",
    "        while (type != null) {",
    "            try {",
    '                Method method = type.getDeclaredMethod("getAvailableRecipeMaps");',
    "                method.setAccessible(true);",
    "                Object value = method.invoke(mte);",
    "                List<Object> recipeMaps = new ArrayList<Object>();",
    "                if (value instanceof Iterable) {",
    "                    for (Object entry : (Iterable) value) {",
    "                        if (entry instanceof RecipeMap) {",
    "                            recipeMaps.add(entry);",
    "                        }",
    "                    }",
    "                }",
    "                return recipeMaps;",
    "            } catch (NoSuchMethodException ignored) {",
    "                type = type.getSuperclass();",
    "            } catch (Throwable ignored) {",
    "                return new ArrayList<Object>();",
    "            }",
    "        }",
    "        return new ArrayList<Object>();",
    "    }",
    "",
    "    private static Object getMetaTileEntityRecipeMap(Object mte) {",
    "        Class<?> type = mte == null ? null : mte.getClass();",
    "        while (type != null) {",
    "            try {",
    '                Method method = type.getDeclaredMethod("getRecipeMap");',
    "                method.setAccessible(true);",
    "                Object value = method.invoke(mte);",
    "                return value instanceof RecipeMap ? value : null;",
    "            } catch (NoSuchMethodException ignored) {",
    "                type = type.getSuperclass();",
    "            } catch (Throwable ignored) {",
    "                return null;",
    "            }",
    "        }",
    "        return null;",
    "    }",
    "",
    "    private static Object getMetaTileEntityForStack(ItemStack stack) {",
    "        if (stack == null || stack.getItem() == null || GregTechAPI.sBlockMachines == null) {",
    "            return null;",
    "        }",
    "",
    "        try {",
    "            if (net.minecraft.block.Block.getBlockFromItem(stack.getItem()) != GregTechAPI.sBlockMachines) {",
    "                return null;",
    "            }",
    "            int meta = stack.getItemDamage();",
    "            if (meta <= 0 || meta >= GregTechAPI.METATILEENTITIES.length) {",
    "                return null;",
    "            }",
    "            return GregTechAPI.METATILEENTITIES[meta];",
    "        } catch (Throwable ignored) {",
    "            return null;",
    "        }",
    "    }",
    "",
    "    private static void appendMetaTileEntityTooltip(Item item, Object mte) {",
    "        if (item == null || mte == null) {",
    "            return;",
    "        }",
    "",
    '        Integer maxParallels = getMetaTileEntityInteger(mte, "getMaxParallelRecipes");',
    "        if (maxParallels != null && maxParallels > 1) {",
    "            item.mp = maxParallels;",
    "        }",
    "        item.mb = Boolean.valueOf(isMultiblockMetaTileEntity(mte));",
    "",
    "        List<String> tooltip = getMetaTileEntityTooltipLines(mte);",
    "        if (tooltip.isEmpty()) {",
    "            return;",
    "        }",
    "",
    "        if (item.tt == null) {",
    "            item.tt = tooltip;",
    "            return;",
    "        }",
    "",
    "        for (String line : tooltip) {",
    "            if (!item.tt.contains(line)) {",
    "                item.tt.add(line);",
    "            }",
    "        }",
    "    }",
    "",
    "    private static List<String> getMetaTileEntityTooltipLines(Object mte) {",
    "        List<String> lines = new ArrayList<String>();",
    '        appendMetaTileEntityTooltipMethod(lines, mte, "getPrimaryDescription");',
    '        appendMetaTileEntityTooltipMethod(lines, mte, "getDescription");',
    "        return lines;",
    "    }",
    "",
    "    private static Integer getMetaTileEntityInteger(Object mte, String methodName) {",
    "        Class<?> type = mte == null ? null : mte.getClass();",
    "        while (type != null) {",
    "            try {",
    "                Method method = type.getDeclaredMethod(methodName);",
    "                method.setAccessible(true);",
    "                Object value = method.invoke(mte);",
    "                return value instanceof Number ? Integer.valueOf(((Number) value).intValue()) : null;",
    "            } catch (NoSuchMethodException ignored) {",
    "                type = type.getSuperclass();",
    "            } catch (Throwable ignored) {",
    "                return null;",
    "            }",
    "        }",
    "        return null;",
    "    }",
    "",
    "    private static void appendMetaTileEntityTooltipMethod(List<String> lines, Object mte, String methodName) {",
    "        Class<?> type = mte == null ? null : mte.getClass();",
    "        while (type != null) {",
    "            try {",
    "                Method method = type.getDeclaredMethod(methodName);",
    "                method.setAccessible(true);",
    "                appendTooltipValue(lines, method.invoke(mte));",
    "                return;",
    "            } catch (NoSuchMethodException ignored) {",
    "                type = type.getSuperclass();",
    "            } catch (Throwable ignored) {",
    "                return;",
    "            }",
    "        }",
    "    }",
    "",
    "    private static void appendTooltipValue(List<String> lines, Object value) {",
    "        if (value instanceof String[]) {",
    "            String[] array = (String[]) value;",
    "            for (int i = 0; i < array.length; i++) {",
    "                appendTooltipLine(lines, array[i]);",
    "            }",
    "        } else if (value instanceof Iterable) {",
    "            for (Object line : (Iterable) value) {",
    "                appendTooltipLine(lines, line == null ? null : line.toString());",
    "            }",
    "        } else if (value instanceof String) {",
    "            appendTooltipLine(lines, (String) value);",
    "        }",
    "    }",
    "",
    "    private static void appendTooltipLine(List<String> lines, String line) {",
    '        String clean = EnumChatFormatting.getTextWithoutFormattingCodes(line == null ? "" : line).trim();',
    "        if (!clean.isEmpty() && !lines.contains(clean)) {",
    "            lines.add(clean);",
    "        }",
    "    }",
    "",
    "    private static boolean containsItem(List<Item> items, Item candidate) {",
    "        for (Item item : items) {",
    "            if (safeEquals(item.id, candidate.id) && item.m == candidate.m) {",
    "                return true;",
    "            }",
    "        }",
    "        return false;",
    "    }",
    "",
    "    private static boolean safeEquals(String left, String right) {",
    "        return left == null ? right == null : left.equals(right);",
    "    }",
    "",
    "    private static boolean handlerMatchesTransferRect(TemplateRecipeHandler handler, String transferRectId) {",
    "        if (transferRectId.equals(handler.getHandlerId()) || transferRectId.equals(handler.getOverlayIdentifier())) {",
    "            return true;",
    "        }",
    "        try {",
    "            TemplateRecipeHandler instance = handler.newInstance();",
    "            if (instance.transferRects == null || instance.transferRects.isEmpty()) {",
    "                instance.loadTransferRects();",
    "            }",
    "            for (Object rawRect : instance.transferRects) {",
    "                if (!(rawRect instanceof TemplateRecipeHandler.RecipeTransferRect)) {",
    "                    continue;",
    "                }",
    "                TemplateRecipeHandler.RecipeTransferRect rect = (TemplateRecipeHandler.RecipeTransferRect) rawRect;",
    '                String outputId = readStringField(rect, "outputId");',
    "                String specified = instance.specifyTransferRect();",
    "                if ((specified == null || specified.equals(outputId)) && transferRectId.equals(outputId)) {",
    "                    return true;",
    "                }",
    "            }",
    "        } catch (Throwable ignored) {",
    "            return false;",
    "        }",
    "        return false;",
    "    }",
    "",
    "    private static String readStringField(Object target, String fieldName) {",
    "        if (target == null) {",
    "            return null;",
    "        }",
    "        try {",
    "            Field field = target.getClass().getDeclaredField(fieldName);",
    "            field.setAccessible(true);",
    "            Object value = field.get(target);",
    "            return value instanceof String ? (String) value : null;",
    "        } catch (Throwable ignored) {",
    "            return null;",
    "        }",
    "    }",
    "",
    "    private static List<String> getNeiRecipeHandlers(String outputId) {",
    "        List<String> handlers = new ArrayList<String>();",
    "        if (outputId == null || outputId.isEmpty()) {",
    "            return handlers;",
    "        }",
    "",
    "        for (Object rawHandler : GuiCraftingRecipe.craftinghandlers) {",
    "            if (!(rawHandler instanceof TemplateRecipeHandler)) {",
    "                continue;",
    "            }",
    "",
    "            TemplateRecipeHandler handler = (TemplateRecipeHandler) rawHandler;",
    "            if (!handlerAcceptsOutputId(handler, outputId)) {",
    "                continue;",
    "            }",
    "",
    "            String recipeName = handler.getRecipeName();",
    "            if (recipeName != null && !recipeName.isEmpty() && !handlers.contains(recipeName)) {",
    "                handlers.add(recipeName);",
    "            }",
    "        }",
    "        return handlers;",
    "    }",
    "",
    "    private static Map<String, Object> getPassiveNeiRecipes() {",
    "        List<Map<String, Object>> handlers = new ArrayList<Map<String, Object>>();",
    "",
    "        collectPassiveNeiRecipes(handlers, GuiCraftingRecipe.craftinghandlers, false);",
    "        collectPassiveNeiRecipes(handlers, GuiUsageRecipe.usagehandlers, true);",
    "",
    "        if (handlers.isEmpty()) {",
    "            return null;",
    "        }",
    "",
    "        Map<String, Object> source = new HashMap<String, Object>();",
    '        source.put("type", "neiPassive");',
    '        source.put("handlers", handlers);',
    "        return source;",
    "    }",
    "",
    "    private static void collectPassiveNeiRecipes(List<Map<String, Object>> handlers, List<?> rawHandlers, boolean usageMode) {",
    "        for (Object rawHandler : rawHandlers) {",
    "            if (!(rawHandler instanceof TemplateRecipeHandler)) {",
    "                continue;",
    "            }",
    "",
    "            TemplateRecipeHandler handler = (TemplateRecipeHandler) rawHandler;",
    "            String recipeName = handler.getRecipeName();",
    "            if (!isPassiveNeiRecipeHandler(handler, recipeName)) {",
    "                continue;",
    "            }",
    "",
    "            List<Map<String, Object>> recipes = exportPassiveNeiHandlerRecipes(handler, usageMode);",
    '            RecipeExporterMod.log.info("Passive NEI candidate " + recipeName + " (" + handler.getClass().getName() + ") exported " + recipes.size() + " recipes.");',
    "            if (recipes.isEmpty()) {",
    "                continue;",
    "            }",
    "",
    "            Map<String, Object> entry = new HashMap<String, Object>();",
    '            entry.put("n", recipeName);',
    '            entry.put("recipes", recipes);',
    "            handlers.add(entry);",
    "        }",
    "    }",
    "",
    "    private static boolean isPassiveNeiRecipeHandler(TemplateRecipeHandler handler, String recipeName) {",
    "        if (handler == null && recipeName == null) {",
    "            return false;",
    "        }",
    "",
    '        String normalized = EnumChatFormatting.getTextWithoutFormattingCodes(String.valueOf(recipeName) + " " + (handler == null ? "" : handler.getClass().getName())).toLowerCase();',
    '        return normalized.contains("ic2 crop")',
    '            || normalized.contains("cropsnh")',
    '            || normalized.contains("crops nh")',
    '            || normalized.contains("cropnh")',
    '            || normalized.contains("crop product")',
    '            || normalized.contains("crop production")',
    '            || normalized.contains("beeproduct")',
    '            || normalized.contains("bee product")',
    '            || normalized.contains("bee production")',
    '            || normalized.contains("beebetteratbees")',
    '            || normalized.contains("forestry.apiculture")',
    '            || normalized.contains("apiary")',
    '            || normalized.contains("alveary");',
    "    }",
    "",
    "    private static List<Map<String, Object>> exportPassiveNeiHandlerRecipes(TemplateRecipeHandler handler, boolean usageMode) {",
    "        List<Map<String, Object>> recipes = new ArrayList<Map<String, Object>>();",
    "        TemplateRecipeHandler instance;",
    "",
    "        try {",
    "            instance = handler.newInstance();",
    "        } catch (Throwable ignored) {",
    "            instance = handler;",
    "        }",
    "",
    '        loadPassiveNeiRecipes(instance, callStringMethod(handler, "getOverlayIdentifier"), usageMode);',
    "        loadPassiveNeiRecipes(instance, handler.getRecipeName(), usageMode);",
    "",
    "        for (Object cachedRecipe : getCachedNeiRecipes(instance)) {",
    "            Map<String, Object> recipe = exportPassiveNeiRecipe(cachedRecipe);",
    "            if (recipe != null) {",
    "                recipes.add(recipe);",
    "            }",
    "        }",
    "",
    "        return recipes;",
    "    }",
    "",
    "    private static void loadPassiveNeiRecipes(TemplateRecipeHandler handler, String outputId, boolean usageMode) {",
    "        if (handler == null || outputId == null || outputId.isEmpty()) {",
    "            return;",
    "        }",
    "",
    "        try {",
    "            if (usageMode) {",
    "                handler.loadUsageRecipes(outputId, new Object[0]);",
    "            } else {",
    "                handler.loadCraftingRecipes(outputId, new Object[0]);",
    "            }",
    "        } catch (Throwable ignored) {",
    "        }",
    "    }",
    "",
    "    private static List<?> getCachedNeiRecipes(TemplateRecipeHandler handler) {",
    "        try {",
    '            Field field = TemplateRecipeHandler.class.getDeclaredField("arecipes");',
    "            field.setAccessible(true);",
    "            Object value = field.get(handler);",
    "            return value instanceof List ? (List<?>) value : new ArrayList<Object>();",
    "        } catch (Throwable ignored) {",
    "            return new ArrayList<Object>();",
    "        }",
    "    }",
    "",
    "    private static Map<String, Object> exportPassiveNeiRecipe(Object cachedRecipe) {",
    '        List<Item> inputs = formatPositionedStacks(invokePositionedStackList(cachedRecipe, "getIngredients"));',
    '        PositionedStack resultStack = invokePositionedStack(cachedRecipe, "getResult");',
    "        List<Item> outputs = new ArrayList<Item>();",
    "        Item result = formatPositionedStack(resultStack);",
    "        if (result != null) {",
    "            outputs.add(result);",
    "        }",
    "",
    "        if (outputs.isEmpty()) {",
    "            return null;",
    "        }",
    "",
    "        Map<String, Object> recipe = new HashMap<String, Object>();",
    '        recipe.put("iI", inputs);',
    '        recipe.put("iO", outputs);',
    "        return recipe;",
    "    }",
    "",
    "    private static List<Item> formatPositionedStacks(List<PositionedStack> stacks) {",
    "        List<Item> items = new ArrayList<Item>();",
    "        for (PositionedStack stack : stacks) {",
    "            Item item = formatPositionedStack(stack);",
    "            if (item != null) {",
    "                items.add(item);",
    "            }",
    "        }",
    "        return items;",
    "    }",
    "",
    "    private static Item formatPositionedStack(PositionedStack stack) {",
    "        if (stack == null || stack.item == null || !(stack.item instanceof ItemStack)) {",
    "            return null;",
    "        }",
    "",
    "        return RecipeUtil.formatGregtechItemStack((ItemStack) stack.item);",
    "    }",
    "",
    "    private static PositionedStack invokePositionedStack(Object target, String methodName) {",
    "        Object value = callNoArgMethod(target, methodName);",
    "        return value instanceof PositionedStack ? (PositionedStack) value : null;",
    "    }",
    "",
    "    private static List<PositionedStack> invokePositionedStackList(Object target, String methodName) {",
    "        Object value = callNoArgMethod(target, methodName);",
    "        List<PositionedStack> stacks = new ArrayList<PositionedStack>();",
    "        if (!(value instanceof List)) {",
    "            return stacks;",
    "        }",
    "",
    "        for (Object entry : (List<?>) value) {",
    "            if (entry instanceof PositionedStack) {",
    "                stacks.add((PositionedStack) entry);",
    "            }",
    "        }",
    "        return stacks;",
    "    }",
    "",
    "    private static Object callNoArgMethod(Object target, String methodName) {",
    "        if (target == null) {",
    "            return null;",
    "        }",
    "",
    "        try {",
    "            Method method = target.getClass().getMethod(methodName);",
    "            method.setAccessible(true);",
    "            return method.invoke(target);",
    "        } catch (Throwable ignored) {",
    "            return null;",
    "        }",
    "    }",
    "",
    "    private static String callStringMethod(Object target, String methodName) {",
    "        Object value = callNoArgMethod(target, methodName);",
    "        return value instanceof String ? (String) value : null;",
    "    }",
    "",
    "    private static boolean handlerAcceptsOutputId(TemplateRecipeHandler handler, String outputId) {",
    "        try {",
    "            TemplateRecipeHandler instance = handler.newInstance();",
    "            int before = recipeCount(instance);",
    "            instance.loadCraftingRecipes(outputId, new Object[0]);",
    "            return recipeCount(instance) > before;",
    "        } catch (Throwable ignored) {",
    "            return false;",
    "        }",
    "    }",
    "",
    "    private static int recipeCount(TemplateRecipeHandler handler) {",
    "        try {",
    '            Field field = TemplateRecipeHandler.class.getDeclaredField("arecipes");',
    "            field.setAccessible(true);",
    "            Object recipes = field.get(handler);",
    "            return recipes instanceof List ? ((List<?>) recipes).size() : 0;",
    "        } catch (Throwable ignored) {",
    "            return 0;",
    "        }",
    "    }",
    "",
    "    private static Map<String, Object> buildRuntimeCalculation(RecipeMap<RecipeMapBackend> map, GTRecipe rawRecipe) {",
    "        Map<String, Object> out = new HashMap<String, Object>();",
    "        out.put(\"sourceKind\", \"gregtech-overclock-calculator\");",
    "        out.put(\"sourceClass\", \"gregtech.api.util.OverclockCalculator\");",
    "        out.put(\"recipeMap\", String.valueOf(map));",
    "        out.put(\"status\", \"computed\");",
    "        out.put(\"oracleEligible\", Boolean.TRUE);",
    "        out.put(\"strict\", Boolean.TRUE);",
    "        List<Map<String, Object>> variants = new ArrayList<Map<String, Object>>();",
    "        int minimumTier = voltageTierForEu(rawRecipe.mEUt);",
    "        for (int tier = minimumTier; tier < GT_VOLTAGE_NAMES.length; tier++) {",
    "            Map<String, Object> variant = calculateRuntimeVariant(rawRecipe, tier);",
    "            if (variant != null) {",
    "                variants.add(variant);",
    "            }",
    "        }",
    "        out.put(\"variants\", variants);",
    "        if (variants.isEmpty()) {",
    "            out.put(\"status\", \"partial\");",
    "            List<String> warnings = new ArrayList<String>();",
    "            warnings.add(\"OverclockCalculator runtime invocation did not return any variant.\");",
    "            out.put(\"warnings\", warnings);",
    "        }",
    "        return out;",
    "    }",
    "",
    "    private static Map<String, Object> calculateRuntimeVariant(GTRecipe rawRecipe, int tier) {",
    "        try {",
    "            Class<?> calculatorClass = Class.forName(\"gregtech.api.util.OverclockCalculator\");",
    "            Object calculator = calculatorClass.getConstructor().newInstance();",
    "            callFluent(calculator, \"setRecipeEUt\", Long.TYPE, Long.valueOf(Math.max(0, rawRecipe.mEUt)));",
    "            callFluent(calculator, \"setEUt\", Long.TYPE, Long.valueOf(GT_VOLTAGES[tier]));",
    "            callFluent(calculator, \"setDuration\", Integer.TYPE, Integer.valueOf(Math.max(1, rawRecipe.mDuration)));",
    "            callFluent(calculator, \"setParallel\", Integer.TYPE, Integer.valueOf(1));",
    "            callFluent(calculator, \"calculate\");",
    "            int duration = ((Number) calculatorClass.getMethod(\"getDuration\").invoke(calculator)).intValue();",
    "            long eut = ((Number) calculatorClass.getMethod(\"getConsumption\").invoke(calculator)).longValue();",
    "            Map<String, Object> variant = new HashMap<String, Object>();",
    "            variant.put(\"id\", \"tier-\" + GT_VOLTAGE_NAMES[tier].toLowerCase());",
    "            variant.put(\"label\", GT_VOLTAGE_NAMES[tier]);",
    "            variant.put(\"overclockTier\", GT_VOLTAGE_NAMES[tier]);",
    "            variant.put(\"durationTicks\", Integer.valueOf(Math.max(1, duration)));",
    "            variant.put(\"eut\", Long.valueOf(Math.max(0L, eut)));",
    "            variant.put(\"parallel\", Integer.valueOf(1));",
    "            return variant;",
    "        } catch (Throwable t) {",
    "            return null;",
    "        }",
    "    }",
    "",
    "    private static Object callFluent(Object target, String methodName) throws Exception {",
    "        Method method = target.getClass().getMethod(methodName);",
    "        return method.invoke(target);",
    "    }",
    "",
    "    private static Object callFluent(Object target, String methodName, Class<?> parameterType, Object value) throws Exception {",
    "        Method method = target.getClass().getMethod(methodName, parameterType);",
    "        return method.invoke(target, value);",
    "    }",
    "",
    "    private static int voltageTierForEu(long eut) {",
    "        long value = Math.max(0L, Math.abs(eut));",
    "        for (int tier = 0; tier < GT_VOLTAGES.length; tier++) {",
    "            if (value <= GT_VOLTAGES[tier]) {",
    "                return tier;",
    "            }",
    "        }",
    "        return GT_VOLTAGES.length - 1;",
    "    }",
    "",
    "    private static final String[] GT_VOLTAGE_NAMES = new String[] {",
    "        \"ULV\", \"LV\", \"MV\", \"HV\", \"EV\", \"IV\", \"LuV\", \"ZPM\", \"UV\", \"UHV\", \"UEV\", \"UIV\", \"UXV\", \"OpV\", \"MAX\"",
    "    };",
    "",
    "    private static final long[] GT_VOLTAGES = new long[] {",
    "        8L, 32L, 128L, 512L, 2048L, 8192L, 32768L, 131072L, 524288L, 2097152L, 8388608L, 33554432L, 134217728L, 536870912L, Long.MAX_VALUE",
    "    };",
    "",
    "    private static void addNeiSlots(GregtechRecipe recipe, RecipeMap<RecipeMapBackend> map, GTRecipe rawRecipe) {",
    "        try {",
    "            BasicUIProperties ui = map.getFrontend().getUIProperties();",
    '            addNeiSlotFrames(recipe, "input", "item", ui.itemInputPositionsGetter.apply(Math.max(ui.maxItemInputs, rawRecipe.mInputs.length)));',
    '            addNeiSlotFrames(recipe, "output", "item", ui.itemOutputPositionsGetter.apply(Math.max(ui.maxItemOutputs, rawRecipe.mOutputs.length)));',
    '            addNeiSlotFrames(recipe, "input", "fluid", ui.fluidInputPositionsGetter.apply(Math.max(ui.maxFluidInputs, rawRecipe.mFluidInputs.length)));',
    '            addNeiSlotFrames(recipe, "output", "fluid", ui.fluidOutputPositionsGetter.apply(Math.max(ui.maxFluidOutputs, rawRecipe.mFluidOutputs.length)));',
    "            if (ui.useSpecialSlot) {",
    "                Pos2d position = ui.specialItemPositionGetter.get();",
    '                recipe.sl.add(new GregtechRecipe.Slot("input", "item", GregtechRecipe.SPECIAL_SLOT_INDEX, position.x, position.y));',
    "            }",
    "            if (ui.useProgressBar && ui.progressBarPos != null && ui.progressBarSize != null) {",
    "                recipe.pb.add(new GregtechRecipe.ProgressBar(ui.progressBarPos.x, ui.progressBarPos.y, ui.progressBarSize.width, ui.progressBarSize.height, ui.progressBarDirection.toString()));",
    "            }",
    "        } catch (Throwable ignored) {",
    "            // Keep RecEx compatible with GTNH builds whose frontend API differs.",
    "        }",
    "    }",
    "",
    "    private static void addNeiSlotFrames(GregtechRecipe recipe, String side, String kind, List<Pos2d> positions) {",
    "        for (int index = 0; index < positions.size(); index++) {",
    "            Pos2d position = positions.get(index);",
    "            recipe.sl.add(new GregtechRecipe.Slot(side, kind, index, position.x, position.y));",
    "        }",
    "    }",
    "",
    "    private static int[] callChanceGetter(Object target, String methodName, int count) {",
    "        if (target == null || count <= 0) {",
    "            return null;",
    "        }",
    "",
    "        try {",
    "            Method method = target.getClass().getMethod(methodName, int.class);",
    "            int[] chances = new int[count];",
    "            boolean hasChance = false;",
    "            for (int index = 0; index < count; index++) {",
    "                Object value = method.invoke(target, Integer.valueOf(index));",
    "                if (value instanceof Number) {",
    "                    chances[index] = ((Number) value).intValue();",
    "                    if (chances[index] >= 0 && chances[index] < 10000) {",
    "                        hasChance = true;",
    "                    }",
    "                }",
    "            }",
    "            return hasChance ? chances : null;",
    "        } catch (Throwable ignored) {",
    "            return null;",
    "        }",
    "    }",
    "",
    "    private List<ShapedRecipe> getShapedRecipes() {",
  ].join("\n"),
);

if (!exporterSource.includes("item.nc = Boolean.TRUE;")) {
  exporterSource = replaceRequired(
    exporterSource,
    /\/\/ item inputs\s+for\(ItemStack stack : rec\.mInputs\)\{\s+Item item = RecipeUtil\.formatGregtechItemStack\(stack\);\s+if\(item == null\)\{\s+continue;\s+\}\s+gtr\.iI\.add\(item\);\s+\}\s+\/\/ item outputs/,
    [
      "// item inputs",
      "int[] inputChances = getInputChances(rec, rec.mInputs.length);",
      "int inputIndex = 0;",
      "for(ItemStack stack : rec.mInputs){",
      "    Item item = RecipeUtil.formatGregtechItemStack(stack);",
      "    if(item == null){",
      "        inputIndex++;",
      "        continue;",
      "    }",
      "    if (inputChances != null && inputIndex < inputChances.length && inputChances[inputIndex] <= 0) {",
      "        item.nc = Boolean.TRUE;",
      "    }",
      "    inputIndex++;",
      "    item.sl = Integer.valueOf(inputIndex - 1);",
      "    gtr.iI.add(item);",
      "}",
      "// item outputs",
    ].join("\n"),
    "GregTech item input chance export loop",
  );
}

if (!exporterSource.includes("item.ch = Integer.valueOf(outputChance);")) {
  exporterSource = replaceRequired(
    exporterSource,
    /\/\/ item outputs\s+for\(ItemStack stack : rec\.mOutputs\)\{\s+Item item = RecipeUtil\.formatGregtechItemStack\(stack\);\s+if\(item == null\)\{\s+continue;\s+\}\s+gtr\.iO\.add\(item\);\s+\}\s+\/\/ fluid inputs/,
    [
      "// non-consumed item inputs / special items",
      "if (rec.mSpecialItems != null) {",
      "    if (rec.mSpecialItems instanceof ItemStack) {",
      "        Item item = RecipeUtil.formatGregtechItemStack((ItemStack) rec.mSpecialItems);",
      "        if (item != null) {",
      "            item.sl = Integer.valueOf(GregtechRecipe.SPECIAL_SLOT_INDEX);",
      "            gtr.iNC.add(item);",
      "        }",
      "    } else if (rec.mSpecialItems instanceof Object[]) {",
      "        for (Object special : (Object[]) rec.mSpecialItems) {",
      "            if (!(special instanceof ItemStack)) continue;",
      "            Item item = RecipeUtil.formatGregtechItemStack((ItemStack) special);",
      "            if (item != null) {",
      "                item.sl = Integer.valueOf(GregtechRecipe.SPECIAL_SLOT_INDEX);",
      "                gtr.iNC.add(item);",
      "            }",
      "        }",
      "    } else if (rec.mSpecialItems instanceof Iterable) {",
      "        for (Object special : (Iterable<?>) rec.mSpecialItems) {",
      "            if (!(special instanceof ItemStack)) continue;",
      "            Item item = RecipeUtil.formatGregtechItemStack((ItemStack) special);",
      "            if (item != null) {",
      "                item.sl = Integer.valueOf(GregtechRecipe.SPECIAL_SLOT_INDEX);",
      "                gtr.iNC.add(item);",
      "            }",
      "        }",
      "    }",
      "}",
      "// item outputs",
      "int outputIndex = 0;",
      "for(ItemStack stack : rec.mOutputs){",
      "    Item item = RecipeUtil.formatGregtechItemStack(stack);",
      "    if(item == null){",
      "        outputIndex++;",
      "        continue;",
      "    }",
      "    int outputChance = rec.getOutputChance(outputIndex);",
      "    if (outputChance > 0 && outputChance < 10000) {",
      "        item.ch = Integer.valueOf(outputChance);",
      "    }",
      "    outputIndex++;",
      "    item.sl = Integer.valueOf(outputIndex - 1);",
      "    gtr.iO.add(item);",
      "}",
      "// fluid inputs",
    ].join("\n"),
    "GregTech item output export loop",
  );
}

if (!exporterSource.includes("private static int[] getOutputChances(")) {
  exporterSource = replaceRequired(
    exporterSource,
    /\}\s+private Object getShapedRecipes\(\)\{/,
    [
      "}",
      "private static int[] getInputChances(Object recipe, int inputCount) {",
      '    int[] fieldChances = readIntArrayField(recipe, new String[] { "mInputChances", "mInputChance" });',
      "    if (fieldChances != null) {",
      "        return fieldChances;",
      "    }",
      '    return callChanceGetter(recipe, "getInputChance", inputCount);',
      "}",
      "private static int[] getOutputChances(Object recipe, int outputCount) {",
      '    int[] fieldChances = readIntArrayField(recipe, new String[] { "mOutputChances", "mChances", "mOutputChance" });',
      "    if (fieldChances != null) {",
      "        return fieldChances;",
      "    }",
      '    return callChanceGetter(recipe, "getOutputChance", outputCount);',
      "}",
      "private static int[] compactOutputChances(Object recipe, ItemStack[] outputs) {",
      "    int[] sourceChances = getOutputChances(recipe, outputs.length);",
      "    if (sourceChances == null) {",
      "        return null;",
      "    }",
      "    int len = 0;",
      "    for (int index = 0; index < outputs.length; index++) {",
      "        if (outputs[index] != null) {",
      "            len++;",
      "        }",
      "    }",
      "    int[] chances = new int[len];",
      "    int next = 0;",
      "    for (int index = 0; index < outputs.length; index++) {",
      "        if (outputs[index] != null) {",
      "            chances[next++] = index < sourceChances.length ? sourceChances[index] : 10000;",
      "        }",
      "    }",
      "    return chances;",
      "}",
      "private static void setOutputChances(Object recipe, int[] chances) {",
      "    if (recipe == null || chances == null) {",
      "        return;",
      "    }",
      '    writeIntArrayField(recipe, new String[] { "mOutputChances", "mChances", "mOutputChance" }, chances);',
      "}",
      "private static int[] readIntArrayField(Object target, String[] fieldNames) {",
      "    if (target == null) {",
      "        return null;",
      "    }",
      "    Class<?> type = target.getClass();",
      "    while (type != null) {",
      "        for (String fieldName : fieldNames) {",
      "            try {",
      "                Field field = type.getDeclaredField(fieldName);",
      "                field.setAccessible(true);",
      "                Object value = field.get(target);",
      "                if (value instanceof int[]) {",
      "                    return (int[]) value;",
      "                }",
      "            } catch (NoSuchFieldException ignored) {",
      "            } catch (IllegalAccessException ignored) {",
      "                return null;",
      "            }",
      "        }",
      "        type = type.getSuperclass();",
      "    }",
      "    return null;",
      "}",
      "private static boolean writeIntArrayField(Object target, String[] fieldNames, int[] value) {",
      "    if (target == null) {",
      "        return false;",
      "    }",
      "    Class<?> type = target.getClass();",
      "    while (type != null) {",
      "        for (String fieldName : fieldNames) {",
      "            try {",
      "                Field field = type.getDeclaredField(fieldName);",
      "                field.setAccessible(true);",
      "                field.set(target, value);",
      "                return true;",
      "            } catch (NoSuchFieldException ignored) {",
      "            } catch (IllegalAccessException ignored) {",
      "                return false;",
      "            }",
      "        }",
      "        type = type.getSuperclass();",
      "    }",
      "    return false;",
      "}",
      "private static int[] callChanceGetter(Object target, String methodName, int count) {",
      "    if (target == null || count <= 0) {",
      "        return null;",
      "    }",
      "    try {",
      "        Method method = target.getClass().getMethod(methodName, int.class);",
      "        int[] chances = new int[count];",
      "        boolean hasChance = false;",
      "        for (int index = 0; index < count; index++) {",
      "            Object value = method.invoke(target, Integer.valueOf(index));",
      "            if (value instanceof Number) {",
      "                chances[index] = ((Number) value).intValue();",
      "                if (chances[index] >= 0 && chances[index] < 10000) {",
      "                    hasChance = true;",
      "                }",
      "            }",
      "        }",
      "        return hasChance ? chances : null;",
      "    } catch (Throwable ignored) {",
      "        return null;",
      "    }",
      "}",
      "private Object getShapedRecipes(){",
    ].join("\n"),
    "GregTech output chance helper insertion point",
  );
}

await fs.writeFile(exporterPath, exporterSource);

const gregtechRecipePath = path.join(
  repoDir,
  "src/main/java/com/bigbass/recex/recipes/gregtech/GregtechRecipe.java",
);
let gregtechRecipeSource = await fs.readFile(gregtechRecipePath, "utf8");
if (!gregtechRecipeSource.includes("import java.util.Map;")) {
  gregtechRecipeSource = gregtechRecipeSource.replace(
    "import java.util.List;\n",
    "import java.util.List;\nimport java.util.Map;\n",
  );
}
gregtechRecipeSource = gregtechRecipeSource.replace(
  "    /** itemOutputs */\n    public List<Item> iO;\n",
  [
    "    /** non-consumed itemInputs */",
    "    public List<Item> iNC;",
    "",
    "    /** itemOutputs */",
    "    public List<Item> iO;",
  ].join("\n") + "\n",
);
gregtechRecipeSource = gregtechRecipeSource.replace(
  "        iO = new ArrayList<Item>();\n",
  "        iNC = new ArrayList<Item>();\n        iO = new ArrayList<Item>();\n",
);
gregtechRecipeSource = gregtechRecipeSource.replace(
  "    /** fluidOutputs */\n    public List<Fluid> fO;\n",
  [
    "    /** fluidOutputs */",
    "    public List<Fluid> fO;",
    "    /** GTNH runtime calculation oracle payload */",
    "    public Map<String, Object> rc;",
    "    /** NEI slot frames */",
    "    public List<Slot> sl;",
    "    /** NEI progress bars */",
    "    public List<ProgressBar> pb;",
    "",
    "    public static final int SPECIAL_SLOT_INDEX = 100000;",
    "",
    "    public static class Slot {",
    "        public String s;",
    "        public String k;",
    "        public int i;",
    "        public int x;",
    "        public int y;",
    "",
    "        public Slot(String side, String kind, int index, int x, int y) {",
    "            this.s = side;",
    "            this.k = kind;",
    "            this.i = index;",
    "            this.x = x;",
    "            this.y = y;",
    "        }",
    "    }",
    "",
    "    public static class ProgressBar {",
    "        public int x;",
    "        public int y;",
    "        public int w;",
    "        public int h;",
    "        public String d;",
    "",
    "        public ProgressBar(int x, int y, int width, int height, String direction) {",
    "            this.x = x;",
    "            this.y = y;",
    "            this.w = width;",
    "            this.h = height;",
    "            this.d = direction;",
    "        }",
    "    }",
  ].join("\n") + "\n",
);
gregtechRecipeSource = gregtechRecipeSource.replace(
  "        fO = new ArrayList<Fluid>();\n",
  "        fO = new ArrayList<Fluid>();\n        sl = new ArrayList<Slot>();\n        pb = new ArrayList<ProgressBar>();\n",
);
await fs.writeFile(gregtechRecipePath, gregtechRecipeSource);

const gregtechMachinePath = path.join(
  repoDir,
  "src/main/java/com/bigbass/recex/recipes/gregtech/GregtechMachine.java",
);
let gregtechMachineSource = await fs.readFile(gregtechMachinePath, "utf8");
if (!gregtechMachineSource.includes("public List<Item> cat;")) {
  gregtechMachineSource = gregtechMachineSource.replace(
    "import java.util.List;\n",
    "import java.util.List;\n\nimport com.bigbass.recex.recipes.ingredients.Item;\n",
  );
  gregtechMachineSource = gregtechMachineSource.replace(
    "    /** recipes */\n    public List<GregtechRecipe> recs;\n",
    [
      "    /** NEI transfer rect id */",
      "    public String nei;",
      "    /** NEI catalysts */",
      "    public List<Item> cat;",
      "    /** NEI recipe handler labels */",
      "    public List<String> handlers;",
      "    /** recipes */",
      "    public List<GregtechRecipe> recs;",
    ].join("\n") + "\n",
  );
  gregtechMachineSource = gregtechMachineSource.replace(
    "        recs = new ArrayList<GregtechRecipe>();\n",
    "        cat = new ArrayList<Item>();\n        handlers = new ArrayList<String>();\n        recs = new ArrayList<GregtechRecipe>();\n",
  );
  await fs.writeFile(gregtechMachinePath, gregtechMachineSource);
}
if (!gregtechMachineSource.includes("public List<String> handlers;")) {
  gregtechMachineSource = gregtechMachineSource.replace(
    "    /** recipes */\n    public List<GregtechRecipe> recs;\n",
    "    /** NEI recipe handler labels */\n    public List<String> handlers;\n    /** recipes */\n    public List<GregtechRecipe> recs;\n",
  );
  gregtechMachineSource = gregtechMachineSource.replace(
    "        recs = new ArrayList<GregtechRecipe>();\n",
    "        handlers = new ArrayList<String>();\n        recs = new ArrayList<GregtechRecipe>();\n",
  );
  await fs.writeFile(gregtechMachinePath, gregtechMachineSource);
}

const itemPath = path.join(
  repoDir,
  "src/main/java/com/bigbass/recex/recipes/ingredients/Item.java",
);
let itemSource = await fs.readFile(itemPath, "utf8");
if (!itemSource.includes("public Integer ch;")) {
  itemSource = itemSource.replace(
    "    /** nbt tag */\n    public String nbt;\n",
    [
      "    /** nbt tag */",
      "    public String nbt;",
      "",
      "    /** cleaned tooltip lines */",
      "    public java.util.List<String> tt;",
      "",
      "    /** output chance, 10000 = 100% */",
      "    public Integer ch;",
      "",
      "    /** non-consumed input */",
      "    public Boolean nc;",
      "",
      "    /** rendered item stack icon filename */",
      "    public String ic;",
      "",
      "    /** native NEI slot index */",
      "    public Integer sl;",
      "",
      "    /** max parallel recipes reported by the machine controller */",
      "    public Integer mp;",
      "",
      "    /** true when this stack is a multiblock controller */",
      "    public Boolean mb;",
      "",
    ].join("\n"),
  );
}
if (!itemSource.includes("public Integer ch;")) {
  itemSource = replaceRequired(
    itemSource,
    /public String lN;\s*/,
    [
      "public String lN;",
      "",
      "/** nbt tag */",
      "public String nbt;",
      "",
      "/** cleaned tooltip lines */",
      "public java.util.List<String> tt;",
      "",
      "/** output chance, 10000 = 100% */",
      "public Integer ch;",
      "",
      "/** non-consumed input */",
      "public Boolean nc;",
      "",
      "/** rendered item stack icon filename */",
      "public String ic;",
      "",
      "/** native NEI slot index */",
      "public Integer sl;",
      "",
      "/** max parallel recipes reported by the machine controller */",
      "public Integer mp;",
      "",
      "/** true when this stack is a multiblock controller */",
      "public Boolean mb;",
      "",
    ].join("\n"),
    "RecEx item metadata fields",
  );
}
if (!itemSource.includes("public java.util.List<String> tt;")) {
  itemSource = replaceRequired(
    itemSource,
    /public String nbt;\s*/,
    [
      "public String nbt;",
      "",
      "/** cleaned tooltip lines */",
      "public java.util.List<String> tt;",
      "",
    ].join("\n"),
    "RecEx item tooltip field",
  );
}
if (!itemSource.includes("public Boolean nc;")) {
  itemSource = replaceRequired(
    itemSource,
    /public Integer ch;\s*/,
    ["public Integer ch;", "", "/** non-consumed input */", "public Boolean nc;", ""].join("\n"),
    "RecEx item non-consumed field",
  );
}
if (!itemSource.includes("public Integer sl;")) {
  itemSource = replaceRequired(
    itemSource,
    /public String ic;\s*/,
    ["public String ic;", "", "/** native NEI slot index */", "public Integer sl;", ""].join("\n"),
    "RecEx item NEI slot field",
  );
}
if (!itemSource.includes("public Integer mp;")) {
  itemSource = replaceRequired(
    itemSource,
    /public Integer sl;\s*/,
    [
      "public Integer sl;",
      "",
      "/** max parallel recipes reported by the machine controller */",
      "public Integer mp;",
      "",
      "/** true when this stack is a multiblock controller */",
      "public Boolean mb;",
      "",
    ].join("\n"),
    "RecEx item max parallel field",
  );
}
if (!itemSource.includes("public Boolean mb;")) {
  itemSource = replaceRequired(
    itemSource,
    /public Integer mp;\s*/,
    [
      "public Integer mp;",
      "",
      "/** true when this stack is a multiblock controller */",
      "public Boolean mb;",
      "",
    ].join("\n"),
    "RecEx item multiblock marker field",
  );
}
await fs.writeFile(itemPath, itemSource);

const recipeUtilPath = path.join(
  repoDir,
  "src/main/java/com/bigbass/recex/recipes/gregtech/RecipeUtil.java",
);
let recipeUtilSource = await fs.readFile(recipeUtilPath, "utf8");
recipeUtilSource = recipeUtilSource.replace(
  "import com.bigbass.recex.recipes.ingredients.Fluid;",
  [
    "import com.bigbass.recex.icons.FluidStackIconExporter;",
    "import com.bigbass.recex.icons.ItemStackIconExporter;",
    "import com.bigbass.recex.recipes.ingredients.Fluid;",
  ].join("\n"),
);
recipeUtilSource = recipeUtilSource.replaceAll(
  "\n        return item;\n    }\n\n    public static Item format",
  "\n        item.ic = ItemStackIconExporter.captureIcon(iconStack(stack));\n        return item;\n    }\n\n    public static Item format",
);
recipeUtilSource = recipeUtilSource.replace(
  "\n        return item;\n    }\n\n    /**\n     * Might return null!",
  "\n        item.ic = ItemStackIconExporter.captureIcon(iconStack(stack));\n        return item;\n    }\n\n    /**\n     * Might return null!",
);
recipeUtilSource = recipeUtilSource.replace(
  "\n        return fluid;\n    }\n\n    /**\n     * Retrieves all items",
  "\n        fluid.ic = FluidStackIconExporter.captureIcon(stack);\n        return fluid;\n    }\n\n    /**\n     * Retrieves all items",
);
recipeUtilSource = recipeUtilSource.replaceAll(
  "ItemStackIconExporter.captureIcon(stack)",
  "ItemStackIconExporter.captureIcon(iconStack(stack))",
);
if (!recipeUtilSource.includes("ItemStackIconExporter.captureIcon(iconStack(stack))")) {
  let itemCaptureInsertions = 0;
  recipeUtilSource = recipeUtilSource.replace(
    /\n(\s*)return item;\s*\n(\s*)\}/g,
    (match, indent, braceIndent) => {
      if (itemCaptureInsertions >= 2) {
        return match;
      }

      itemCaptureInsertions += 1;
      return `\n${indent}item.ic = ItemStackIconExporter.captureIcon(iconStack(stack));\n${indent}return item;\n${braceIndent}}`;
    },
  );
}
if (!recipeUtilSource.includes("private static ItemStack iconStack(")) {
  recipeUtilSource = replaceRequired(
    recipeUtilSource,
    /\n\s*\/\*\*\s*\n\s*\* Might return null!/,
    [
      "",
      "\tprivate static ItemStack iconStack(ItemStack stack){",
      "\t\tif(stack == null){",
      "\t\t\treturn null;",
      "\t\t}",
      "\t\tItemStack copy = stack.copy();",
      "\t\tif(copy.stackSize <= 0){",
      "\t\t\tcopy.stackSize = 1;",
      "\t\t}",
      "\t\treturn copy;",
      "\t}",
      "",
      "\t/**",
      "\t * Might return null!",
    ].join("\n"),
    "RecEx icon stack size helper",
  );
}
await fs.writeFile(recipeUtilPath, recipeUtilSource);

const fluidPath = path.join(
  repoDir,
  "src/main/java/com/bigbass/recex/recipes/ingredients/Fluid.java",
);
let fluidSource = await fs.readFile(fluidPath, "utf8");
fluidSource = fluidSource.replace(
  "    /** localizedName */\n    public String lN;\n",
  [
    "    /** localizedName */",
    "    public String lN;",
    "",
    "    /** rendered fluid icon filename */",
    "    public String ic;",
    "",
    "    /** native NEI slot index */",
    "    public Integer sl;",
    "",
  ].join("\n"),
);
if (!fluidSource.includes("public String ic;")) {
  fluidSource = replaceRequired(
    fluidSource,
    /public String lN;\s*/,
    [
      "public String lN;",
      "",
      "/** rendered fluid icon filename */",
      "public String ic;",
      "",
      "/** native NEI slot index */",
      "public Integer sl;",
      "",
    ].join("\n"),
    "RecEx fluid icon field",
  );
}
if (!fluidSource.includes("public Integer sl;")) {
  fluidSource = replaceRequired(
    fluidSource,
    /public String ic;\s*/,
    ["public String ic;", "", "/** native NEI slot index */", "public Integer sl;", ""].join("\n"),
    "RecEx fluid NEI slot field",
  );
}
await fs.writeFile(fluidPath, fluidSource);

const iconPackageDir = path.join(repoDir, "src/main/java/com/bigbass/recex/icons");
await fs.mkdir(iconPackageDir, { recursive: true });
await fs.writeFile(
  path.join(iconPackageDir, "ItemStackIconExporter.java"),
  await fs.readFile(
    path.join(iconExporterTemplateDir, "com/bigbass/recex/icons/ItemStackIconExporter.java"),
    "utf8",
  ),
);

await fs.writeFile(
  path.join(iconPackageDir, "FluidStackIconExporter.java"),
  await fs.readFile(
    path.join(iconExporterTemplateDir, "com/bigbass/recex/icons/FluidStackIconExporter.java"),
    "utf8",
  ),
);

await fs.writeFile(
  path.join(iconPackageDir, "ClientFluidStackIconRenderer.java"),
  await fs.readFile(
    path.join(iconExporterTemplateDir, "com/bigbass/recex/icons/ClientFluidStackIconRenderer.java"),
    "utf8",
  ),
);

await fs.writeFile(
  path.join(iconPackageDir, "ClientItemStackIconRenderer.java"),
  `package com.bigbass.recex.icons;

import java.awt.image.BufferedImage;
import java.io.File;
import java.lang.reflect.Field;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import javax.imageio.ImageIO;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.FontRenderer;
import net.minecraft.client.renderer.RenderHelper;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.client.renderer.entity.RenderItem;
import net.minecraft.client.renderer.texture.TextureMap;
import net.minecraft.client.shader.Framebuffer;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.IIcon;
import net.minecraft.util.ResourceLocation;

import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;

import com.bigbass.recex.RecipeExporterMod;

public final class ClientItemStackIconRenderer {

    private static final int ICON_SIZE = Integer.getInteger("recex.iconSize", 32);
    private static final int MAX_RENDER_FAILURES = Integer.getInteger("recex.maxIconRenderFailures", 200);
    private static final Map<String, String> CACHE = new ConcurrentHashMap<String, String>();
    private static final AtomicInteger RENDER_FAILURES = new AtomicInteger(0);
    private static final RenderItem RENDER_ITEM = new RenderItem();

    private ClientItemStackIconRenderer() {}

    public static String captureIcon(ItemStack stack) {
        if (stack == null || stack.getItem() == null || stack.stackSize <= 0) {
            return null;
        }

        try {
            String key = stackKey(stack);
            String cached = CACHE.get(key);
            if (cached != null) {
                return cached.length() > 0 ? cached : null;
            }
            if (RENDER_FAILURES.get() >= MAX_RENDER_FAILURES) {
                return null;
            }

            File outDir = iconDir();
            if (!outDir.exists() && !outDir.mkdirs()) {
                return null;
            }

            String filename = safeName(stack) + "-" + sha1(key).substring(0, 12) + ".png";
            File outFile = new File(outDir, filename);
            if (!outFile.isFile()) {
                renderToPng(stack, outFile);
            }

            CACHE.put(key, filename);
            return filename;
        } catch (Throwable t) {
            int failureCount = RENDER_FAILURES.incrementAndGet();
            CACHE.put(stackKey(stack), "");
            if (failureCount <= 25 || failureCount == MAX_RENDER_FAILURES) {
                RecipeExporterMod.log.warn("Failed to render icon for " + stack + ": " + t.toString());
            }
            if (failureCount == MAX_RENDER_FAILURES) {
                RecipeExporterMod.log.warn("Disabling further RecEx icon rendering after " + failureCount + " failures.");
            }
            return null;
        }
    }

    private static void renderToPng(ItemStack stack, File outFile) throws Exception {
        BufferedImage image = renderWithMinecraftItemRenderer(stack);
        if (image == null) {
            throw new IllegalStateException("No icon renderer is available for " + stack);
        }

        ImageIO.write(image, "png", outFile);
    }

    private static BufferedImage renderFromLoadedTextureAtlas(ItemStack stack) throws Exception {
        Minecraft mc = Minecraft.getMinecraft();
        if (mc == null || mc.getTextureManager() == null) {
            throw new IllegalStateException("Minecraft client is not ready.");
        }

        Item item = stack.getItem();
        int passes = item.requiresMultipleRenderPasses() ? Math.max(1, item.getRenderPasses(stack.getItemDamage())) : 1;
        BufferedImage output = new BufferedImage(ICON_SIZE, ICON_SIZE, BufferedImage.TYPE_INT_ARGB);
        boolean renderedAnyPass = false;

        for (int pass = 0; pass < passes; pass++) {
            IIcon icon = iconForPass(stack, pass);
            if (icon == null) {
                continue;
            }

            ResourceLocation atlas = item.getSpriteNumber() == 0
                ? TextureMap.locationBlocksTexture
                : TextureMap.locationItemsTexture;
            BufferedImage atlasImage = readBoundAtlas(mc, atlas);
            if (atlasImage == null) {
                continue;
            }

            int color = item.getColorFromItemStack(stack, pass);
            drawIconPass(output, atlasImage, icon, color);
            renderedAnyPass = true;
        }

        return renderedAnyPass && imageHasVisiblePixels(output) ? output : null;
    }

    private static BufferedImage renderWithMinecraftItemRenderer(ItemStack stack) throws Exception {
        Minecraft mc = Minecraft.getMinecraft();
        if (mc == null || mc.getTextureManager() == null) {
            throw new IllegalStateException("Minecraft client is not ready.");
        }

        Framebuffer framebuffer = new Framebuffer(ICON_SIZE, ICON_SIZE, true);
        ByteBuffer buffer;
        boolean projectionPushed = false;
        boolean modelViewPushed = false;

        try {
            resetTessellator();
            framebuffer.bindFramebuffer(true);

            GL11.glViewport(0, 0, ICON_SIZE, ICON_SIZE);
            GL11.glClearColor(0.0F, 0.0F, 0.0F, 0.0F);
            GL11.glClear(GL11.GL_COLOR_BUFFER_BIT | GL11.GL_DEPTH_BUFFER_BIT);

            GL11.glMatrixMode(GL11.GL_PROJECTION);
            GL11.glPushMatrix();
            projectionPushed = true;
            GL11.glLoadIdentity();
            GL11.glOrtho(0.0D, ICON_SIZE, ICON_SIZE, 0.0D, 1000.0D, 3000.0D);

            GL11.glMatrixMode(GL11.GL_MODELVIEW);
            GL11.glPushMatrix();
            modelViewPushed = true;
            GL11.glLoadIdentity();
            GL11.glTranslatef(0.0F, 0.0F, -2000.0F);

            RenderHelper.enableGUIStandardItemLighting();
            GL11.glEnable(GL12.GL_RESCALE_NORMAL);
            FontRenderer fontRenderer = stack.getItem().getFontRenderer(stack);
            if (fontRenderer == null) {
                fontRenderer = mc.fontRenderer;
            }
            resetTessellator();
            RENDER_ITEM.renderItemIntoGUI(fontRenderer, mc.getTextureManager(), stack, (ICON_SIZE - 16) / 2, (ICON_SIZE - 16) / 2);
            resetTessellator();
            RenderHelper.disableStandardItemLighting();

            GL11.glMatrixMode(GL11.GL_MODELVIEW);
            GL11.glPopMatrix();
            modelViewPushed = false;
            GL11.glMatrixMode(GL11.GL_PROJECTION);
            GL11.glPopMatrix();
            projectionPushed = false;
            GL11.glMatrixMode(GL11.GL_MODELVIEW);

            buffer = BufferUtils.createByteBuffer(ICON_SIZE * ICON_SIZE * 4);
            GL11.glReadPixels(0, 0, ICON_SIZE, ICON_SIZE, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);
        } finally {
            RenderHelper.disableStandardItemLighting();
            resetTessellator();
            if (modelViewPushed) {
                GL11.glMatrixMode(GL11.GL_MODELVIEW);
                GL11.glPopMatrix();
            }
            if (projectionPushed) {
                GL11.glMatrixMode(GL11.GL_PROJECTION);
                GL11.glPopMatrix();
            }
            GL11.glMatrixMode(GL11.GL_MODELVIEW);
            framebuffer.unbindFramebuffer();
            framebuffer.deleteFramebuffer();
        }

        BufferedImage image = new BufferedImage(ICON_SIZE, ICON_SIZE, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < ICON_SIZE; y++) {
            for (int x = 0; x < ICON_SIZE; x++) {
                int index = (x + (ICON_SIZE - 1 - y) * ICON_SIZE) * 4;
                int r = buffer.get(index) & 255;
                int g = buffer.get(index + 1) & 255;
                int b = buffer.get(index + 2) & 255;
                int a = buffer.get(index + 3) & 255;
                image.setRGB(x, y, (a << 24) | (r << 16) | (g << 8) | b);
            }
        }

        return imageHasVisiblePixels(image) ? image : null;
    }

    private static IIcon iconForPass(ItemStack stack, int pass) {
        Item item = stack.getItem();
        IIcon icon = null;
        try {
            icon = item.getIcon(stack, pass);
        } catch (Throwable ignored) {
            icon = null;
        }
        if (icon == null) {
            try {
                icon = item.getIconFromDamageForRenderPass(stack.getItemDamage(), pass);
            } catch (Throwable ignored) {
                icon = null;
            }
        }
        if (icon == null && pass == 0) {
            try {
                icon = item.getIconIndex(stack);
            } catch (Throwable ignored) {
                icon = null;
            }
        }
        return icon;
    }

    private static BufferedImage readBoundAtlas(Minecraft mc, ResourceLocation atlas) {
        mc.getTextureManager().bindTexture(atlas);
        int width = GL11.glGetTexLevelParameteri(GL11.GL_TEXTURE_2D, 0, GL11.GL_TEXTURE_WIDTH);
        int height = GL11.glGetTexLevelParameteri(GL11.GL_TEXTURE_2D, 0, GL11.GL_TEXTURE_HEIGHT);
        if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
            return null;
        }

        ByteBuffer buffer = BufferUtils.createByteBuffer(width * height * 4);
        GL11.glGetTexImage(GL11.GL_TEXTURE_2D, 0, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);

        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int index = (x + (height - 1 - y) * width) * 4;
                int r = buffer.get(index) & 255;
                int g = buffer.get(index + 1) & 255;
                int b = buffer.get(index + 2) & 255;
                int a = buffer.get(index + 3) & 255;
                image.setRGB(x, y, (a << 24) | (r << 16) | (g << 8) | b);
            }
        }
        return image;
    }

    private static void drawIconPass(BufferedImage output, BufferedImage atlas, IIcon icon, int color) {
        int tintR = (color >> 16) & 255;
        int tintG = (color >> 8) & 255;
        int tintB = color & 255;
        int minX = clamp((int)Math.floor(icon.getMinU() * atlas.getWidth()), 0, atlas.getWidth() - 1);
        int maxX = clamp((int)Math.ceil(icon.getMaxU() * atlas.getWidth()), minX + 1, atlas.getWidth());
        int minY = clamp((int)Math.floor(icon.getMinV() * atlas.getHeight()), 0, atlas.getHeight() - 1);
        int maxY = clamp((int)Math.ceil(icon.getMaxV() * atlas.getHeight()), minY + 1, atlas.getHeight());

        for (int y = 0; y < ICON_SIZE; y++) {
            int sourceY = minY + Math.min(maxY - minY - 1, (y * (maxY - minY)) / ICON_SIZE);
            for (int x = 0; x < ICON_SIZE; x++) {
                int sourceX = minX + Math.min(maxX - minX - 1, (x * (maxX - minX)) / ICON_SIZE);
                int source = atlas.getRGB(sourceX, sourceY);
                int a = (source >>> 24) & 255;
                if (a == 0) {
                    continue;
                }

                int r = (((source >> 16) & 255) * tintR) / 255;
                int g = (((source >> 8) & 255) * tintG) / 255;
                int b = ((source & 255) * tintB) / 255;
                int tinted = (a << 24) | (r << 16) | (g << 8) | b;
                output.setRGB(x, y, alphaComposite(tinted, output.getRGB(x, y)));
            }
        }
    }

    private static int alphaComposite(int source, int destination) {
        int sa = (source >>> 24) & 255;
        int da = (destination >>> 24) & 255;
        int outA = sa + ((da * (255 - sa)) / 255);
        if (outA == 0) {
            return 0;
        }

        int sr = (source >> 16) & 255;
        int sg = (source >> 8) & 255;
        int sb = source & 255;
        int dr = (destination >> 16) & 255;
        int dg = (destination >> 8) & 255;
        int db = destination & 255;
        int outR = (sr * sa + dr * da * (255 - sa) / 255) / outA;
        int outG = (sg * sa + dg * da * (255 - sa) / 255) / outA;
        int outB = (sb * sa + db * da * (255 - sa) / 255) / outA;

        return (outA << 24) | (outR << 16) | (outG << 8) | outB;
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static boolean imageHasVisiblePixels(BufferedImage image) {
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                if (((image.getRGB(x, y) >>> 24) & 255) > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    private static void resetTessellator() {
        String[] fieldNames = new String[] { "isDrawing", "field_78415_z" };
        for (String fieldName : fieldNames) {
            try {
                Field isDrawing = Tessellator.class.getDeclaredField(fieldName);
                isDrawing.setAccessible(true);
                if (isDrawing.getBoolean(Tessellator.instance)) {
                    isDrawing.setBoolean(Tessellator.instance, false);
                }
                return;
            } catch (Throwable ignored) {
            }
        }
    }

    private static File iconDir() {
        String configured = System.getProperty("recex.iconDir");
        if (configured != null && configured.trim().length() > 0) {
            return new File(configured);
        }
        return new File(Minecraft.getMinecraft().mcDataDir, "RecEx-Rendered-Icons");
    }

    private static String stackKey(ItemStack stack) {
        String nbt = stack.hasTagCompound() ? stack.getTagCompound().toString() : "";
        return String.valueOf(net.minecraft.item.Item.itemRegistry.getNameForObject(stack.getItem()))
            + "@" + stack.getItemDamage()
            + "#" + nbt;
    }

    private static String safeName(ItemStack stack) {
        String raw;
        try {
            raw = String.valueOf(stack.getDisplayName());
        } catch (Throwable t) {
            raw = String.valueOf(net.minecraft.item.Item.itemRegistry.getNameForObject(stack.getItem()));
        }
        String safe = raw.toLowerCase().replaceAll("[^a-z0-9._-]+", "_").replaceAll("^_+|_+$", "");
        return safe.length() > 0 ? safe.substring(0, Math.min(safe.length(), 60)) : "item";
    }

    private static String sha1(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        byte[] bytes = digest.digest(value.getBytes("UTF-8"));
        StringBuilder builder = new StringBuilder();
        for (byte b : bytes) {
            builder.append(String.format("%02x", b & 255));
        }
        return builder.toString();
    }
}
`,
);

await copyIconExporterTemplate(
  "com/bigbass/recex/icons/ClientItemStackIconRenderer.java",
  path.join(iconPackageDir, "ClientItemStackIconRenderer.java"),
);

async function copyIconExporterTemplate(relativePath, destinationPath) {
  await fs.copyFile(path.join(iconExporterTemplateDir, relativePath), destinationPath);
}

function replaceRequired(source, searchValue, replacement, label) {
  const replaced = source.replace(searchValue, replacement);
  if (replaced === source) {
    throw new Error(`Failed to patch RecEx source: ${label}.`);
  }
  return replaced;
}
