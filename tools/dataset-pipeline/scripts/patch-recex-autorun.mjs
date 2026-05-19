import fs from "node:fs/promises";
import path from "node:path";

const repoDir = process.argv[2];
if (!repoDir) {
  throw new Error("Usage: patch-recex-autorun.mjs <RecEx checkout>");
}

const modPath = path.join(repoDir, "src/main/java/com/bigbass/recex/RecipeExporterMod.java");
let source = await fs.readFile(modPath, "utf8");

source = source.replace(
  "import com.bigbass.recex.proxy.CommonProxy;",
  [
    "import com.bigbass.recex.proxy.CommonProxy;",
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

source = source.replace(
  /(\s+@Mod\.EventHandler\s+public void init\(FMLInitializationEvent e\) \{\s+proxy\.init\(e\);\s+\}\s*)\}/,
  `

    @Mod.EventHandler
    public void init(FMLInitializationEvent e) {
        proxy.init(e);
        if (Boolean.getBoolean("recex.autorun") && FMLCommonHandler.instance().getSide().isClient()) {
            log.info("RecEx autorun registering mod event handler.");
            FMLCommonHandler.instance().bus().register(this);
            startDelayedClientAutorunThread();
        }
    }

    @Mod.EventHandler
    public void serverStarted(FMLServerStartedEvent e) {
        runAutorunExport("server-started");
    }

    @Mod.EventHandler
    public void loadComplete(FMLLoadCompleteEvent e) {
        if (!FMLCommonHandler.instance().getSide().isClient()) {
            return;
        }

        runAutorunExport("client-load-complete");
    }

    @SubscribeEvent
    public void clientTick(TickEvent.ClientTickEvent e) {
        if (e.phase != TickEvent.Phase.END || !FMLCommonHandler.instance().getSide().isClient()) {
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
                Thread.sleep(Long.getLong("recex.autorunDelayMillis", 45000L));
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
                log.info("RecEx autorun export finished.");
            } catch (Throwable t) {
                log.error("RecEx autorun export failed.", t);
                FMLCommonHandler.instance().exitJava(2, false);
                return;
            }

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
    "        if (Boolean.getBoolean(\"recex.autorun\")) {",
    "            FMLCommonHandler.instance().bus().register(new ClientAutorunExportHandler());",
    "        }",
  ].join("\n") + "\n",
);
await fs.writeFile(clientProxyPath, clientProxySource);

const autorunPackageDir = path.join(repoDir, "src/main/java/com/bigbass/recex/autorun");
await fs.mkdir(autorunPackageDir, { recursive: true });
await fs.writeFile(
  path.join(autorunPackageDir, "ClientAutorunExportHandler.java"),
  `package com.bigbass.recex.autorun;

import com.bigbass.recex.RecipeExporterMod;

import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;
import net.minecraft.client.Minecraft;

public final class ClientAutorunExportHandler {

    private int ticks;

    @SubscribeEvent
    public void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) {
            return;
        }

        ticks++;
        if (ticks < Integer.getInteger("recex.autorunDelayTicks", 80)) {
            return;
        }

        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null || minecraft.getTextureManager() == null || minecraft.fontRenderer == null) {
            return;
        }

        RecipeExporterMod.log.info("RecEx autorun client tick handler is ready after " + ticks + " ticks.");
        RecipeExporterMod.requestAutorunExport("client-proxy-tick");
    }
}
`,
);

const exporterPath = path.join(
  repoDir,
  "src/main/java/com/bigbass/recex/recipes/RecipeExporter.java",
);
let exporterSource = await fs.readFile(exporterPath, "utf8");

exporterSource = exporterSource.replace(
  "        out.mInputChances = recipe.mInputChances;\n",
  [
    "        // GTNH stable 2.8.x runtime GregTech does not expose mInputChances.",
    "        // Keep the exporter compatible with both stable and newer daily builds.",
  ].join("\n") + "\n",
);

await fs.writeFile(exporterPath, exporterSource);

const itemPath = path.join(
  repoDir,
  "src/main/java/com/bigbass/recex/recipes/ingredients/Item.java",
);
let itemSource = await fs.readFile(itemPath, "utf8");
itemSource = itemSource.replace(
  "    /** nbt tag */\n    public String nbt;\n",
  [
    "    /** nbt tag */",
    "    public String nbt;",
    "",
    "    /** rendered item stack icon filename */",
    "    public String ic;",
    "",
  ].join("\n"),
);
await fs.writeFile(itemPath, itemSource);

const recipeUtilPath = path.join(
  repoDir,
  "src/main/java/com/bigbass/recex/recipes/gregtech/RecipeUtil.java",
);
let recipeUtilSource = await fs.readFile(recipeUtilPath, "utf8");
recipeUtilSource = recipeUtilSource.replace(
  "import com.bigbass.recex.recipes.ingredients.Fluid;",
  [
    "import com.bigbass.recex.icons.ItemStackIconExporter;",
    "import com.bigbass.recex.recipes.ingredients.Fluid;",
  ].join("\n"),
);
recipeUtilSource = recipeUtilSource.replaceAll(
  "\n        return item;\n    }\n\n    public static Item format",
  "\n        item.ic = ItemStackIconExporter.captureIcon(stack);\n        return item;\n    }\n\n    public static Item format",
);
recipeUtilSource = recipeUtilSource.replace(
  "\n        return item;\n    }\n\n    /**\n     * Might return null!",
  "\n        item.ic = ItemStackIconExporter.captureIcon(stack);\n        return item;\n    }\n\n    /**\n     * Might return null!",
);
await fs.writeFile(recipeUtilPath, recipeUtilSource);

const iconPackageDir = path.join(repoDir, "src/main/java/com/bigbass/recex/icons");
await fs.mkdir(iconPackageDir, { recursive: true });
await fs.writeFile(
  path.join(iconPackageDir, "ItemStackIconExporter.java"),
  `package com.bigbass.recex.icons;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

import net.minecraft.item.ItemStack;

import com.bigbass.recex.RecipeExporterMod;

public final class ItemStackIconExporter {

    private static boolean warned;

    private ItemStackIconExporter() {}

    public static String captureIcon(ItemStack stack) {
        if (stack == null || !Boolean.getBoolean("recex.renderIcons")) {
            return null;
        }

        try {
            Class<?> renderer = Class.forName("com.bigbass.recex.icons.ClientItemStackIconRenderer");
            Method method = renderer.getMethod("captureIcon", ItemStack.class);
            Object value = method.invoke(null, stack);
            return value instanceof String ? (String) value : null;
        } catch (InvocationTargetException e) {
            warnOnce(e.getCause());
        } catch (Throwable t) {
            warnOnce(t);
        }

        return null;
    }

    private static void warnOnce(Throwable t) {
        if (warned) {
            return;
        }

        warned = true;
        RecipeExporterMod.log.warn("RecEx rendered stack icons are unavailable; continuing without rendered icons.", t);
    }
}
`,
);

await fs.writeFile(
  path.join(iconPackageDir, "ClientItemStackIconRenderer.java"),
  `package com.bigbass.recex.icons;

import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import javax.imageio.ImageIO;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.FontRenderer;
import net.minecraft.client.renderer.RenderHelper;
import net.minecraft.client.renderer.entity.RenderItem;
import net.minecraft.client.shader.Framebuffer;
import net.minecraft.item.ItemBlock;
import net.minecraft.item.ItemStack;

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
        if (stack == null || stack.getItem() == null || stack.stackSize <= 0 || stack.getItem() instanceof ItemBlock) {
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
        Minecraft mc = Minecraft.getMinecraft();
        if (mc == null || mc.getTextureManager() == null) {
            throw new IllegalStateException("Minecraft client is not ready.");
        }

        Framebuffer framebuffer = new Framebuffer(ICON_SIZE, ICON_SIZE, true);
        ByteBuffer buffer;
        boolean projectionPushed = false;
        boolean modelViewPushed = false;

        try {
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
            RENDER_ITEM.renderItemIntoGUI(fontRenderer, mc.getTextureManager(), stack, (ICON_SIZE - 16) / 2, (ICON_SIZE - 16) / 2);
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

        ImageIO.write(image, "png", outFile);
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
