package dev.gtnhplanner.calcoracle;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import cpw.mods.fml.common.Loader;
import dev.gtnhplanner.calcoracle.icons.FluidStackIconExporter;
import dev.gtnhplanner.calcoracle.icons.ItemStackIconExporter;
import gregtech.api.recipe.RecipeMap;
import gregtech.api.recipe.RecipeMapBackend;
import gregtech.api.util.GTRecipe;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.crafting.CraftingManager;
import net.minecraft.item.crafting.FurnaceRecipes;
import net.minecraft.item.crafting.IRecipe;
import net.minecraft.item.crafting.ShapedRecipes;
import net.minecraft.item.crafting.ShapelessRecipes;
import net.minecraft.util.StatCollector;
import net.minecraftforge.fluids.FluidStack;
import net.minecraftforge.oredict.OreDictionary;
import net.minecraftforge.oredict.ShapedOreRecipe;
import net.minecraftforge.oredict.ShapelessOreRecipe;

import java.io.File;
import java.io.FileWriter;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

public final class GtnhCalcOracleExporter {

    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create();
    private static final String[] GT_VOLTAGE_NAMES = new String[] {
        "ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UXV", "OpV", "MAX"
    };
    private static final long[] GT_VOLTAGES = new long[] {
        8L, 32L, 128L, 512L, 2048L, 8192L, 32768L, 131072L, 524288L, 2097152L, 8388608L,
        33554432L, 134217728L, 536870912L, Long.MAX_VALUE
    };

    public ExportResult export() throws Exception {
        String generatedAt = isoNow();
        List<Map<String, Object>> adapters = new ArrayList<Map<String, Object>>();
        List<Map<String, Object>> domains = new ArrayList<Map<String, Object>>();

        domains.add(exportOreDictionary(adapters));
        domains.add(exportGregtech(adapters));
        domains.add(exportCrafting(adapters));
        domains.add(exportSmelting(adapters));
        domains.add(exportThaumcraft(adapters));
        domains.add(exportForestryBees(adapters));
        domains.add(exportIc2Crops(adapters));

        Map<String, Object> root = map();
        root.put("schemaVersion", Integer.valueOf(1));
        root.put("exporter", "gtnh-calculation-oracle");
        root.put("format", "dev.gtnhplanner.oracle.v1");
        root.put("generatedAt", generatedAt);
        root.put("minecraftVersion", "1.7.10");
        root.put("loadedMods", loadedMods());
        root.put("adapters", adapters);
        root.put("domains", domains);

        int recipeCount = countRecipes(domains);
        root.put("recipeCount", Integer.valueOf(recipeCount));

        File outputDir = new File(System.getProperty("gtnh.oracle.outputDir", "GTNH-Calc-Oracle"));
        if (!outputDir.isDirectory() && !outputDir.mkdirs()) {
            throw new IllegalStateException("Could not create oracle output directory: " + outputDir);
        }

        File outputFile = new File(outputDir, "gtnh-oracle-" + safeTimestamp(generatedAt) + ".json");
        FileWriter writer = new FileWriter(outputFile);
        try {
            GSON.toJson(root, writer);
            writer.write('\n');
        } finally {
            writer.close();
        }

        return new ExportResult(outputFile.getAbsolutePath(), recipeCount, adapters.size());
    }

    private Map<String, Object> exportOreDictionary(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("oreDictionary");
        Map<String, Object> entries = map();
        int stackCount = 0;

        for (String name : OreDictionary.getOreNames()) {
            List<Map<String, Object>> alternatives = new ArrayList<Map<String, Object>>();
            for (ItemStack stack : OreDictionary.getOres(name)) {
                Map<String, Object> item = itemStack(stack);
                if (item != null) {
                    alternatives.add(item);
                    stackCount++;
                }
            }
            entries.put(name, alternatives);
        }

        domain.put("entries", entries);
        adapters.add(adapter("ore-dictionary", "computed", true, entries.size(), stackCount, started, null));
        return domain;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> exportGregtech(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("gregtech");
        List<Map<String, Object>> recipeMaps = new ArrayList<Map<String, Object>>();
        int recipeCount = 0;

        try {
            List<RecipeMap<RecipeMapBackend>> maps = new ArrayList<RecipeMap<RecipeMapBackend>>();
            for (RecipeMap<?> recipeMap : RecipeMap.ALL_RECIPE_MAPS.values()) {
                try {
                    maps.add((RecipeMap<RecipeMapBackend>) recipeMap);
                } catch (ClassCastException ignored) {
                }
            }
            Collections.sort(maps, new java.util.Comparator<RecipeMap<RecipeMapBackend>>() {
                @Override
                public int compare(RecipeMap<RecipeMapBackend> left, RecipeMap<RecipeMapBackend> right) {
                    return safeString(left.unlocalizedName).compareTo(safeString(right.unlocalizedName));
                }
            });

            for (RecipeMap<RecipeMapBackend> map : maps) {
                Map<String, Object> exportedMap = map();
                String name = StatCollector.translateToLocal(map.unlocalizedName);
                if (name == null || name.length() == 0 || name.equals(map.unlocalizedName)) {
                    name = map.unlocalizedName;
                }
                exportedMap.put("id", safeString(map.unlocalizedName));
                exportedMap.put("name", name);
                exportedMap.put("sourceClass", map.getClass().getName());

                List<Map<String, Object>> recipes = new ArrayList<Map<String, Object>>();
                List<GTRecipe> rawRecipes = new ArrayList<GTRecipe>(map.getAllRecipes());
                Collections.sort(rawRecipes, new java.util.Comparator<GTRecipe>() {
                    @Override
                    public int compare(GTRecipe left, GTRecipe right) {
                        int outputCompare = firstOutputName(left).compareTo(firstOutputName(right));
                        if (outputCompare != 0) return outputCompare;
                        int eutCompare = Long.compare(left.mEUt, right.mEUt);
                        if (eutCompare != 0) return eutCompare;
                        return Integer.compare(left.mDuration, right.mDuration);
                    }
                });

                int index = 0;
                for (GTRecipe recipe : rawRecipes) {
                    if (!recipe.mEnabled || recipe.mDuration <= 0) {
                        continue;
                    }

                    Map<String, Object> exportedRecipe = map();
                    exportedRecipe.put("id", sha1(map.unlocalizedName + ":" + index + ":" + recipe.toString()).substring(0, 16));
                    exportedRecipe.put("enabled", Boolean.TRUE);
                    exportedRecipe.put("durationTicks", Integer.valueOf(recipe.mDuration));
                    exportedRecipe.put("eut", Long.valueOf(recipe.mEUt));
                    exportedRecipe.put("specialValue", Integer.valueOf(recipe.mSpecialValue));
                    exportedRecipe.put("itemInputs", itemStacks(recipe.mInputs, getInputChances(recipe, recipe.mInputs.length), true));
                    exportedRecipe.put("itemOutputs", outputItemStacks(recipe));
                    exportedRecipe.put("fluidInputs", fluidStacks(recipe.mFluidInputs));
                    exportedRecipe.put("fluidOutputs", fluidStacks(recipe.mFluidOutputs));
                    exportedRecipe.put("nonConsumedInputs", specialItems(recipe.mSpecialItems));
                    exportedRecipe.put("runtimeCalculation", buildGtRuntimeCalculation(name, recipe));
                    recipes.add(exportedRecipe);
                    index++;
                }

                exportedMap.put("recipes", recipes);
                recipeCount += recipes.size();
                recipeMaps.add(exportedMap);
            }

            domain.put("recipeMaps", recipeMaps);
            adapters.add(adapter("gregtech-recipe-maps", "computed", true, recipeMaps.size(), recipeCount, started, null));
        } catch (Throwable t) {
            adapters.add(adapter("gregtech-recipe-maps", "missing", true, 0, recipeCount, started, t.toString()));
        }

        return domain;
    }

    private Map<String, Object> exportCrafting(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("crafting");
        List<Map<String, Object>> recipes = new ArrayList<Map<String, Object>>();

        try {
            List<?> rawRecipes = CraftingManager.getInstance().getRecipeList();
            int index = 0;
            for (Object raw : rawRecipes) {
                if (!(raw instanceof IRecipe)) {
                    continue;
                }
                IRecipe recipe = (IRecipe) raw;
                ItemStack output = recipe.getRecipeOutput();
                if (output == null) {
                    continue;
                }
                Map<String, Object> exported = map();
                exported.put("id", sha1("crafting:" + index + ":" + raw.getClass().getName() + ":" + stackKey(output)).substring(0, 16));
                exported.put("className", raw.getClass().getName());
                exported.put("type", craftingType(raw));
                exported.put("width", readIntField(raw, "recipeWidth"));
                exported.put("height", readIntField(raw, "recipeHeight"));
                exported.put("inputs", craftingInputs(raw));
                exported.put("output", itemStack(output));
                recipes.add(exported);
                index++;
            }
            domain.put("recipes", recipes);
            adapters.add(adapter("minecraft-forge-crafting", "computed", true, 1, recipes.size(), started, null));
        } catch (Throwable t) {
            adapters.add(adapter("minecraft-forge-crafting", "missing", true, 0, recipes.size(), started, t.toString()));
        }

        return domain;
    }

    private Map<String, Object> exportSmelting(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("smelting");
        List<Map<String, Object>> recipes = new ArrayList<Map<String, Object>>();

        try {
            Map<?, ?> smelting = FurnaceRecipes.smelting().getSmeltingList();
            int index = 0;
            for (Map.Entry<?, ?> entry : smelting.entrySet()) {
                if (!(entry.getKey() instanceof ItemStack) || !(entry.getValue() instanceof ItemStack)) {
                    continue;
                }
                Map<String, Object> recipe = map();
                recipe.put("id", sha1("smelting:" + index + ":" + stackKey((ItemStack) entry.getKey())).substring(0, 16));
                recipe.put("input", itemStack((ItemStack) entry.getKey()));
                recipe.put("output", itemStack((ItemStack) entry.getValue()));
                recipes.add(recipe);
                index++;
            }
            domain.put("recipes", recipes);
            adapters.add(adapter("minecraft-furnace", "computed", true, 1, recipes.size(), started, null));
        } catch (Throwable t) {
            adapters.add(adapter("minecraft-furnace", "missing", true, 0, recipes.size(), started, t.toString()));
        }

        return domain;
    }

    private Map<String, Object> exportThaumcraft(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("thaumcraft");
        List<Map<String, Object>> recipes = new ArrayList<Map<String, Object>>();
        boolean present = isClassPresent("thaumcraft.api.ThaumcraftApi") || GtnhCalcOracleMod.isModLoaded("Thaumcraft");

        if (!present) {
            adapters.add(adapter("thaumcraft-crafting", "not_present", false, 0, 0, started, null));
            domain.put("recipes", recipes);
            return domain;
        }

        try {
            Class<?> api = Class.forName("thaumcraft.api.ThaumcraftApi");
            for (Field field : api.getDeclaredFields()) {
                if (!Modifier.isStatic(field.getModifiers()) || !Collection.class.isAssignableFrom(field.getType())) {
                    continue;
                }
                String fieldName = field.getName().toLowerCase(Locale.ROOT);
                if (!fieldName.contains("recipe")) {
                    continue;
                }
                field.setAccessible(true);
                Collection<?> rawRecipes = (Collection<?>) field.get(null);
                if (rawRecipes == null) {
                    continue;
                }
                int index = 0;
                for (Object rawRecipe : rawRecipes) {
                    Map<String, Object> recipe = thaumcraftRecipe(field.getName(), index, rawRecipe);
                    if (recipe != null) {
                        recipes.add(recipe);
                    }
                    index++;
                }
            }
            domain.put("recipes", recipes);
            adapters.add(adapter("thaumcraft-crafting", "computed", true, 1, recipes.size(), started, null));
        } catch (Throwable t) {
            adapters.add(adapter("thaumcraft-crafting", "partial", true, 0, recipes.size(), started, t.toString()));
            domain.put("recipes", recipes);
        }

        return domain;
    }

    private Map<String, Object> exportForestryBees(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("forestryBees");
        List<Map<String, Object>> species = new ArrayList<Map<String, Object>>();
        boolean present = isClassPresent("forestry.api.apiculture.BeeManager") || GtnhCalcOracleMod.isModLoaded("Forestry");

        if (!present) {
            adapters.add(adapter("forestry-bee-species", "not_present", false, 0, 0, started, null));
            domain.put("species", species);
            return domain;
        }

        try {
            Class<?> alleleManager = Class.forName("forestry.api.genetics.AlleleManager");
            Object registry = readStaticField(alleleManager, "alleleRegistry");
            Class<?> chromosomeClass = Class.forName("forestry.api.apiculture.EnumBeeChromosome");
            Object speciesChromosome = Enum.valueOf((Class<Enum>) chromosomeClass.asSubclass(Enum.class), "SPECIES");
            Object alleles = invokeBest(registry, "getRegisteredAlleles", new Object[] { speciesChromosome });
            for (Object allele : iterable(alleles)) {
                Map<String, Object> exported = beeSpecies(allele);
                if (exported != null) {
                    species.add(exported);
                }
            }
            domain.put("species", species);
            adapters.add(adapter("forestry-bee-species", "computed", true, 1, species.size(), started, null));
        } catch (Throwable t) {
            adapters.add(adapter("forestry-bee-species", "partial", true, 0, species.size(), started, t.toString()));
            domain.put("species", species);
        }

        return domain;
    }

    private Map<String, Object> exportIc2Crops(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("ic2Crops");
        List<Map<String, Object>> crops = new ArrayList<Map<String, Object>>();
        boolean present = isClassPresent("ic2.api.crops.Crops") || GtnhCalcOracleMod.isModLoaded("IC2");

        if (!present) {
            adapters.add(adapter("ic2-crop-cards", "not_present", false, 0, 0, started, null));
            domain.put("crops", crops);
            return domain;
        }

        try {
            Object cropsApi = readStaticField(Class.forName("ic2.api.crops.Crops"), "instance");
            Set<Object> seen = Collections.newSetFromMap(new IdentityHashMap<Object, Boolean>());
            for (Method method : cropsApi.getClass().getMethods()) {
                if (method.getParameterTypes().length != 0 || !Collection.class.isAssignableFrom(method.getReturnType())) {
                    continue;
                }
                Object value = method.invoke(cropsApi);
                for (Object candidate : iterable(value)) {
                    if (candidate == null || !seen.add(candidate) || !looksLikeCropCard(candidate)) {
                        continue;
                    }
                    crops.add(cropCard(candidate));
                }
            }
            domain.put("crops", crops);
            String status = crops.isEmpty() ? "partial" : "computed";
            String warning = crops.isEmpty() ? "IC2 crop API was present, but no crop-card collection method returned cards." : null;
            adapters.add(adapter("ic2-crop-cards", status, true, 1, crops.size(), started, warning));
        } catch (Throwable t) {
            adapters.add(adapter("ic2-crop-cards", "partial", true, 0, crops.size(), started, t.toString()));
            domain.put("crops", crops);
        }

        return domain;
    }

    private Map<String, Object> thaumcraftRecipe(String sourceList, int index, Object rawRecipe) {
        if (rawRecipe == null) {
            return null;
        }

        Map<String, Object> recipe = map();
        String className = rawRecipe.getClass().getName();
        String type = thaumcraftType(className);
        recipe.put("id", sha1("thaumcraft:" + sourceList + ":" + index + ":" + className).substring(0, 16));
        recipe.put("sourceList", sourceList);
        recipe.put("type", type);
        recipe.put("className", className);
        putIfPresent(recipe, "research", firstString(rawRecipe, "research", "researchKey", "key"));
        putIfPresent(recipe, "output", resourceFromUnknown(firstObject(rawRecipe, "getRecipeOutput", "recipeOutput", "output")));
        putIfPresent(recipe, "centralInput", resourceFromUnknown(firstObject(rawRecipe, "getRecipeInput", "recipeInput", "input")));
        putIfPresent(recipe, "catalyst", resourceFromUnknown(firstObject(rawRecipe, "getCatalyst", "catalyst")));
        putIfPresent(recipe, "components", resourcesFromUnknown(firstObject(rawRecipe, "getComponents", "components", "recipeItems")));
        putIfPresent(recipe, "aspects", aspectResources(firstObject(rawRecipe, "getAspects", "aspects")));
        putIfPresent(recipe, "instability", firstNumber(rawRecipe, "getInstability", "instability"));
        return recipe;
    }

    private Map<String, Object> beeSpecies(Object allele) {
        if (allele == null) {
            return null;
        }

        Map<String, Object> species = map();
        putIfPresent(species, "uid", invokeString(allele, "getUID"));
        putIfPresent(species, "name", invokeString(allele, "getName"));
        species.put("className", allele.getClass().getName());
        putIfPresent(species, "products", beeProducts(invokeBest(allele, "getProducts", new Object[0])));
        putIfPresent(species, "specialty", beeProducts(invokeBest(allele, "getSpecialty", new Object[0])));
        species.put("cycleTicks", Integer.valueOf(Integer.getInteger("gtnh.oracle.beeCycleTicks", 550)));
        return species;
    }

    private List<Map<String, Object>> beeProducts(Object rawProducts) {
        List<Map<String, Object>> products = new ArrayList<Map<String, Object>>();
        if (!(rawProducts instanceof Map)) {
            return products;
        }
        for (Map.Entry<?, ?> entry : ((Map<?, ?>) rawProducts).entrySet()) {
            Map<String, Object> product = map();
            Map<String, Object> stack = itemStack(entry.getKey() instanceof ItemStack ? (ItemStack) entry.getKey() : null);
            if (stack == null) {
                continue;
            }
            product.put("resource", stack);
            Number chance = asNumber(entry.getValue());
            if (chance != null) {
                double rawChance = chance.doubleValue();
                product.put("rawChance", Double.valueOf(rawChance));
                product.put("chance", Double.valueOf(rawChance > 1.0D ? rawChance / 100.0D : rawChance));
            }
            products.add(product);
        }
        return products;
    }

    private Map<String, Object> cropCard(Object crop) {
        Map<String, Object> exported = map();
        exported.put("className", crop.getClass().getName());
        putIfPresent(exported, "id", firstString(crop, "getId", "id", "name"));
        putIfPresent(exported, "name", firstString(crop, "displayName", "getDisplayName", "name"));
        putIfPresent(exported, "owner", firstString(crop, "owner", "getOwner"));
        putIfPresent(exported, "tier", firstNumber(crop, "tier", "getTier"));
        putIfPresent(exported, "attributes", resourcesFromUnknown(firstObject(crop, "attributes", "getAttributes")));
        exported.put(
            "notes",
            "Crop-card metadata exported from the live IC2 API. Drop simulation needs a crop-tile environment adapter before it is oracle-eligible."
        );
        return exported;
    }

    private Map<String, Object> buildGtRuntimeCalculation(String recipeMapName, GTRecipe recipe) {
        Map<String, Object> out = map();
        out.put("sourceKind", "gregtech-overclock-calculator");
        out.put("sourceClass", "gregtech.api.util.OverclockCalculator");
        out.put("recipeMap", recipeMapName);
        out.put("status", "computed");
        out.put("oracleEligible", Boolean.TRUE);
        out.put("strict", Boolean.TRUE);
        out.put("generatedAt", isoNow());

        List<Map<String, Object>> variants = new ArrayList<Map<String, Object>>();
        int minimumTier = voltageTierForEu(recipe.mEUt);
        for (int tier = minimumTier; tier < GT_VOLTAGE_NAMES.length; tier++) {
            Map<String, Object> variant = buildGtOverclockVariant(recipe, tier);
            if (variant != null) {
                variants.add(variant);
            }
        }
        out.put("variants", variants);
        if (variants.isEmpty()) {
            out.put("status", "missing");
            out.put("warnings", Arrays.asList("OverclockCalculator runtime invocation did not return any variant."));
        }
        return out;
    }

    private Map<String, Object> buildGtOverclockVariant(GTRecipe recipe, int tier) {
        try {
            Class<?> calculatorClass = Class.forName("gregtech.api.util.OverclockCalculator");
            Object calculator = calculatorClass.getConstructor().newInstance();
            callFluent(calculator, "setRecipeEUt", Long.TYPE, Long.valueOf(Math.max(0L, recipe.mEUt)));
            callFluent(calculator, "setEUt", Long.TYPE, Long.valueOf(GT_VOLTAGES[tier]));
            callFluent(calculator, "setDuration", Integer.TYPE, Integer.valueOf(Math.max(1, recipe.mDuration)));
            callFluent(calculator, "setParallel", Integer.TYPE, Integer.valueOf(1));
            callFluent(calculator, "calculate");

            int duration = ((Number) calculatorClass.getMethod("getDuration").invoke(calculator)).intValue();
            long eut = ((Number) calculatorClass.getMethod("getConsumption").invoke(calculator)).longValue();
            Map<String, Object> variant = map();
            variant.put("id", "tier-" + GT_VOLTAGE_NAMES[tier].toLowerCase(Locale.ROOT));
            variant.put("label", GT_VOLTAGE_NAMES[tier]);
            variant.put("overclockTier", GT_VOLTAGE_NAMES[tier]);
            variant.put("durationTicks", Integer.valueOf(Math.max(1, duration)));
            variant.put("eut", Long.valueOf(Math.max(0L, eut)));
            variant.put("parallel", Integer.valueOf(1));
            variant.put("outputs", gtRuntimeOutputs(recipe));
            return variant;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private List<Map<String, Object>> gtRuntimeOutputs(GTRecipe recipe) {
        List<Map<String, Object>> outputs = new ArrayList<Map<String, Object>>();
        int outputIndex = 0;
        for (ItemStack stack : recipe.mOutputs) {
            Map<String, Object> resource = itemStack(stack);
            if (resource != null) {
                int chance = recipe.getOutputChance(outputIndex);
                if (chance > 0 && chance < 10000) {
                    resource.put("chance", Double.valueOf(chance / 10000.0D));
                }
                outputs.add(resource);
            }
            outputIndex++;
        }
        for (FluidStack stack : recipe.mFluidOutputs) {
            Map<String, Object> resource = fluidStack(stack);
            if (resource != null) {
                outputs.add(resource);
            }
        }
        return outputs;
    }

    private Object callFluent(Object target, String methodName) throws Exception {
        Method method = target.getClass().getMethod(methodName);
        return method.invoke(target);
    }

    private Object callFluent(Object target, String methodName, Class<?> parameterType, Object value) throws Exception {
        Method method = target.getClass().getMethod(methodName, parameterType);
        return method.invoke(target, value);
    }

    private List<Map<String, Object>> outputItemStacks(GTRecipe recipe) {
        List<Map<String, Object>> outputs = new ArrayList<Map<String, Object>>();
        int index = 0;
        for (ItemStack stack : recipe.mOutputs) {
            Map<String, Object> item = itemStack(stack);
            if (item != null) {
                int chance = recipe.getOutputChance(index);
                if (chance > 0 && chance < 10000) {
                    item.put("chance", Double.valueOf(chance / 10000.0D));
                }
                outputs.add(item);
            }
            index++;
        }
        return outputs;
    }

    private List<Map<String, Object>> specialItems(Object specialItems) {
        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>();
        for (Object value : iterable(specialItems)) {
            if (value instanceof ItemStack) {
                Map<String, Object> item = itemStack((ItemStack) value);
                if (item != null) {
                    item.put("consumed", Boolean.FALSE);
                    items.add(item);
                }
            }
        }
        return items;
    }

    private List<Map<String, Object>> itemStacks(ItemStack[] stacks, int[] inputChances, boolean markNonConsumed) {
        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>();
        for (int index = 0; index < stacks.length; index++) {
            Map<String, Object> item = itemStack(stacks[index]);
            if (item == null) {
                continue;
            }
            if (markNonConsumed && inputChances != null && index < inputChances.length && inputChances[index] <= 0) {
                item.put("consumed", Boolean.FALSE);
            }
            items.add(item);
        }
        return items;
    }

    private List<Map<String, Object>> fluidStacks(FluidStack[] stacks) {
        List<Map<String, Object>> fluids = new ArrayList<Map<String, Object>>();
        for (FluidStack stack : stacks) {
            Map<String, Object> fluid = fluidStack(stack);
            if (fluid != null) {
                fluids.add(fluid);
            }
        }
        return fluids;
    }

    private Map<String, Object> itemStack(ItemStack stack) {
        if (stack == null || stack.getItem() == null || stack.stackSize <= 0) {
            return null;
        }

        String registryId = String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()));
        if (registryId == null || registryId.length() == 0 || "null".equals(registryId)) {
            return null;
        }

        Map<String, Object> item = map();
        int meta = stack.getItemDamage();
        item.put("kind", "item");
        item.put("id", meta == 0 ? registryId : registryId + "@" + meta);
        item.put("registryId", registryId);
        item.put("meta", Integer.valueOf(meta));
        item.put("amount", Integer.valueOf(stack.stackSize));
        item.put("displayName", displayName(stack));
        String modId = modId(registryId);
        if (modId != null) {
            item.put("modId", modId);
        }
        if (stack.stackTagCompound != null) {
            item.put("nbt", stack.stackTagCompound.toString());
        }
        String icon = ItemStackIconExporter.captureIcon(stack);
        if (icon != null && icon.length() > 0) {
            item.put("icon", icon);
        }
        return item;
    }

    private Map<String, Object> fluidStack(FluidStack stack) {
        if (stack == null || stack.getFluid() == null || stack.amount <= 0) {
            return null;
        }

        Map<String, Object> fluid = map();
        fluid.put("kind", "fluid");
        fluid.put("id", stack.getFluid().getName());
        fluid.put("amount", Integer.valueOf(stack.amount));
        fluid.put("displayName", stack.getLocalizedName());
        String icon = FluidStackIconExporter.captureIcon(stack);
        if (icon != null && icon.length() > 0) {
            fluid.put("icon", icon);
        }
        return fluid;
    }

    private List<Map<String, Object>> craftingInputs(Object recipe) {
        List<Map<String, Object>> inputs = new ArrayList<Map<String, Object>>();
        if (recipe instanceof ShapedRecipes) {
            ShapedRecipes shaped = (ShapedRecipes) recipe;
            for (ItemStack stack : shaped.recipeItems) {
                addUnknownInput(inputs, stack);
            }
            return inputs;
        }
        if (recipe instanceof ShapelessRecipes) {
            ShapelessRecipes shapeless = (ShapelessRecipes) recipe;
            for (Object stack : shapeless.recipeItems) {
                addUnknownInput(inputs, stack);
            }
            return inputs;
        }
        if (recipe instanceof ShapedOreRecipe) {
            for (Object input : ((ShapedOreRecipe) recipe).getInput()) {
                addUnknownInput(inputs, input);
            }
            return inputs;
        }
        if (recipe instanceof ShapelessOreRecipe) {
            for (Object input : ((ShapelessOreRecipe) recipe).getInput()) {
                addUnknownInput(inputs, input);
            }
            return inputs;
        }

        Object recipeItems = firstObject(recipe, "getInput", "recipeItems", "input");
        for (Object input : iterable(recipeItems)) {
            addUnknownInput(inputs, input);
        }
        return inputs;
    }

    private void addUnknownInput(List<Map<String, Object>> inputs, Object input) {
        Map<String, Object> resource = resourceFromUnknown(input);
        if (resource != null) {
            inputs.add(resource);
        }
    }

    private Map<String, Object> resourceFromUnknown(Object input) {
        if (input == null) {
            return null;
        }
        if (input instanceof ItemStack) {
            return itemStack((ItemStack) input);
        }
        if (input instanceof FluidStack) {
            return fluidStack((FluidStack) input);
        }
        if (input instanceof String) {
            return oreDictionaryChoice(Collections.singletonList((String) input), OreDictionary.getOres((String) input));
        }
        if (input instanceof List) {
            return oreDictionaryChoice(Collections.<String>emptyList(), (List<?>) input);
        }
        if (input.getClass().isArray()) {
            List<Map<String, Object>> resources = resourcesFromUnknown(input);
            if (resources.size() == 1) {
                return resources.get(0);
            }
        }
        return null;
    }

    private List<Map<String, Object>> resourcesFromUnknown(Object value) {
        List<Map<String, Object>> resources = new ArrayList<Map<String, Object>>();
        for (Object entry : iterable(value)) {
            Map<String, Object> resource = resourceFromUnknown(entry);
            if (resource != null) {
                resources.add(resource);
            } else if (entry != null) {
                Map<String, Object> text = map();
                text.put("kind", "text");
                text.put("value", String.valueOf(entry));
                resources.add(text);
            }
        }
        return resources;
    }

    private Map<String, Object> oreDictionaryChoice(List<String> names, List<?> rawAlternatives) {
        Map<String, Object> choice = map();
        choice.put("kind", "oreDictionary");
        choice.put("names", names);
        List<Map<String, Object>> alternatives = new ArrayList<Map<String, Object>>();
        for (Object raw : rawAlternatives) {
            if (raw instanceof ItemStack) {
                Map<String, Object> item = itemStack((ItemStack) raw);
                if (item != null) {
                    alternatives.add(item);
                }
            }
        }
        choice.put("alternatives", alternatives);
        return choice;
    }

    private List<Map<String, Object>> aspectResources(Object aspectList) {
        List<Map<String, Object>> aspects = new ArrayList<Map<String, Object>>();
        if (aspectList == null) {
            return aspects;
        }

        Object rawAspects = invokeBest(aspectList, "getAspects", new Object[0]);
        for (Object aspect : iterable(rawAspects)) {
            Number amount = asNumber(invokeBest(aspectList, "getAmount", new Object[] { aspect }));
            if (amount == null || amount.doubleValue() <= 0.0D) {
                continue;
            }
            String tag = invokeString(aspect, "getTag");
            String name = invokeString(aspect, "getName");
            if (tag == null) {
                tag = safeString(aspect);
            }
            Map<String, Object> resource = map();
            resource.put("kind", "aspect");
            resource.put("id", "thaumcraft:aspect:" + tag.toLowerCase(Locale.ROOT));
            resource.put("tag", tag);
            resource.put("amount", amount);
            resource.put("displayName", name == null ? tag : name);
            aspects.add(resource);
        }
        return aspects;
    }

    private int[] getInputChances(Object recipe, int inputCount) {
        int[] chances = callChanceGetter(recipe, "getInputChance", inputCount);
        return chances == null ? callChanceGetter(recipe, "getInputChances", inputCount) : chances;
    }

    private int[] callChanceGetter(Object target, String methodName, int count) {
        if (target == null || count <= 0) {
            return null;
        }
        try {
            Method method = target.getClass().getMethod(methodName, int.class);
            int[] chances = new int[count];
            boolean hasChance = false;
            for (int index = 0; index < count; index++) {
                Object value = method.invoke(target, Integer.valueOf(index));
                if (value instanceof Number) {
                    chances[index] = ((Number) value).intValue();
                    if (chances[index] >= 0 && chances[index] < 10000) {
                        hasChance = true;
                    }
                }
            }
            return hasChance ? chances : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private String firstOutputName(GTRecipe recipe) {
        if (recipe.mOutputs != null) {
            for (ItemStack output : recipe.mOutputs) {
                String key = stackKey(output);
                if (key.length() > 0) return key;
            }
        }
        if (recipe.mFluidOutputs != null) {
            for (FluidStack output : recipe.mFluidOutputs) {
                if (output != null && output.getFluid() != null) return output.getFluid().getName();
            }
        }
        return "";
    }

    private int voltageTierForEu(long eut) {
        long value = Math.max(0L, Math.abs(eut));
        for (int tier = 0; tier < GT_VOLTAGES.length; tier++) {
            if (value <= GT_VOLTAGES[tier]) {
                return tier;
            }
        }
        return GT_VOLTAGES.length - 1;
    }

    private String craftingType(Object recipe) {
        if (recipe instanceof ShapedRecipes || recipe instanceof ShapedOreRecipe) return "shaped";
        if (recipe instanceof ShapelessRecipes || recipe instanceof ShapelessOreRecipe) return "shapeless";
        return recipe.getClass().getName();
    }

    private String thaumcraftType(String className) {
        String lower = className.toLowerCase(Locale.ROOT);
        if (lower.contains("infusion")) return "infusion";
        if (lower.contains("crucible")) return "crucible";
        if (lower.contains("arcane")) return "arcane";
        return "thaumcraft";
    }

    private boolean looksLikeCropCard(Object value) {
        String className = value.getClass().getName().toLowerCase(Locale.ROOT);
        return className.contains("crop") && (hasMethod(value, "tier") || hasMethod(value, "getId") || hasMethod(value, "name"));
    }

    private boolean hasMethod(Object target, String methodName) {
        for (Method method : target.getClass().getMethods()) {
            if (method.getName().equals(methodName) && method.getParameterTypes().length == 0) {
                return true;
            }
        }
        return false;
    }

    private Object firstObject(Object target, String... names) {
        for (String name : names) {
            Object value = invokeBest(target, name, new Object[0]);
            if (value != null) {
                return value;
            }
            value = readField(target, name);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private String firstString(Object target, String... names) {
        Object value = firstObject(target, names);
        return value == null ? null : String.valueOf(value);
    }

    private Number firstNumber(Object target, String... names) {
        return asNumber(firstObject(target, names));
    }

    private Object invokeBest(Object target, String methodName, Object[] args) {
        if (target == null || methodName == null) {
            return null;
        }
        for (Method method : target.getClass().getMethods()) {
            if (!method.getName().equals(methodName) || method.getParameterTypes().length != args.length) {
                continue;
            }
            try {
                return method.invoke(target, args);
            } catch (Throwable ignored) {
            }
        }
        return null;
    }

    private String invokeString(Object target, String methodName) {
        Object value = invokeBest(target, methodName, new Object[0]);
        return value == null ? null : String.valueOf(value);
    }

    private Object readField(Object target, String fieldName) {
        if (target == null) {
            return null;
        }
        Class<?> type = target.getClass();
        while (type != null) {
            try {
                Field field = type.getDeclaredField(fieldName);
                field.setAccessible(true);
                return field.get(target);
            } catch (Throwable ignored) {
                type = type.getSuperclass();
            }
        }
        return null;
    }

    private Object readStaticField(Class<?> type, String fieldName) throws Exception {
        Field field = type.getField(fieldName);
        field.setAccessible(true);
        return field.get(null);
    }

    private Number asNumber(Object value) {
        return value instanceof Number ? (Number) value : null;
    }

    private Iterable<?> iterable(Object value) {
        if (value == null) {
            return Collections.emptyList();
        }
        if (value instanceof Iterable) {
            return (Iterable<?>) value;
        }
        if (value instanceof Map) {
            return ((Map<?, ?>) value).entrySet();
        }
        if (value.getClass().isArray()) {
            List<Object> out = new ArrayList<Object>();
            int length = Array.getLength(value);
            for (int index = 0; index < length; index++) {
                out.add(Array.get(value, index));
            }
            return out;
        }
        return Collections.singletonList(value);
    }

    private int readIntField(Object target, String fieldName) {
        Object value = readField(target, fieldName);
        return value instanceof Number ? ((Number) value).intValue() : 0;
    }

    private void putIfPresent(Map<String, Object> target, String key, Object value) {
        if (value == null) {
            return;
        }
        if (value instanceof Collection && ((Collection<?>) value).isEmpty()) {
            return;
        }
        target.put(key, value);
    }

    private Map<String, Object> domain(String id) {
        Map<String, Object> domain = map();
        domain.put("id", id);
        return domain;
    }

    private Map<String, Object> adapter(
        String id,
        String status,
        boolean detected,
        int subjectCount,
        int recipeCount,
        long started,
        String warning
    ) {
        Map<String, Object> adapter = map();
        adapter.put("id", id);
        adapter.put("status", status);
        adapter.put("detected", Boolean.valueOf(detected));
        adapter.put("subjectCount", Integer.valueOf(subjectCount));
        adapter.put("recipeCount", Integer.valueOf(recipeCount));
        adapter.put("durationMillis", Long.valueOf(System.currentTimeMillis() - started));
        if (warning != null && warning.length() > 0) {
            adapter.put("warnings", Collections.singletonList(warning));
        }
        return adapter;
    }

    private List<String> loadedMods() {
        List<String> mods = new ArrayList<String>();
        for (Object modContainer : Loader.instance().getModList()) {
            Object value = invokeBest(modContainer, "getModId", new Object[0]);
            if (value != null) {
                mods.add(String.valueOf(value));
            }
        }
        Collections.sort(mods);
        return mods;
    }

    private int countRecipes(List<Map<String, Object>> domains) {
        int count = 0;
        for (Map<String, Object> domain : domains) {
            Object recipeMaps = domain.get("recipeMaps");
            for (Object recipeMap : iterable(recipeMaps)) {
                Object recipes = recipeMap instanceof Map ? ((Map<?, ?>) recipeMap).get("recipes") : null;
                for (Object ignored : iterable(recipes)) {
                    count++;
                }
            }
            for (String key : Arrays.asList("recipes", "species", "crops")) {
                for (Object ignored : iterable(domain.get(key))) {
                    count++;
                }
            }
        }
        return count;
    }

    private boolean isClassPresent(String className) {
        try {
            Class.forName(className);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private String displayName(ItemStack stack) {
        try {
            return stack.getDisplayName();
        } catch (Throwable ignored) {
            return stackKey(stack);
        }
    }

    private String stackKey(ItemStack stack) {
        if (stack == null || stack.getItem() == null) {
            return "";
        }
        String registryId = String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()));
        return registryId + "@" + stack.getItemDamage() + "x" + stack.stackSize;
    }

    private String modId(String registryId) {
        int separator = registryId.indexOf(':');
        return separator > 0 ? registryId.substring(0, separator) : null;
    }

    private String sha1(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            byte[] data = digest.digest(value.getBytes("UTF-8"));
            StringBuilder builder = new StringBuilder();
            for (byte b : data) {
                builder.append(String.format("%02x", Byte.valueOf(b)));
            }
            return builder.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private String safeTimestamp(String value) {
        return value.replaceAll("[^0-9T]", "").replace("T", "-");
    }

    private String isoNow() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private String safeString(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private Map<String, Object> map() {
        return new LinkedHashMap<String, Object>();
    }

    public static final class ExportResult {
        public final String outputFile;
        public final int recipeCount;
        public final int adapterCount;

        ExportResult(String outputFile, int recipeCount, int adapterCount) {
            this.outputFile = outputFile;
            this.recipeCount = recipeCount;
            this.adapterCount = adapterCount;
        }
    }
}
