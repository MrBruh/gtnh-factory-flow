package com.bigbass.recex.icons;

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;

import javax.imageio.ImageIO;

import com.bigbass.recex.RecipeExporterMod;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.FontRenderer;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.gui.ScaledResolution;
import net.minecraft.client.renderer.RenderHelper;
import net.minecraft.client.renderer.entity.RenderItem;
import net.minecraft.creativetab.CreativeTabs;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;

public final class ClientItemStackIconRenderer {

    private static final int ICON_SIZE = Integer.getInteger("recex.iconSize", 32);
    private static final int BACKGROUND_COLOR = 0xFFFEFFFF;
    private static final int EXPORT_BATCH_SIZE = Integer.getInteger("recex.iconExportBatchSize", 64);
    private static final Map<String, String> ICONS_BY_STACK_KEY = new LinkedHashMap<String, String>();
    private static final RenderItem RENDER_ITEM = new RenderItem();

    private ClientItemStackIconRenderer() {}

    public static String lookupIcon(ItemStack stack) {
        if (stack == null || stack.getItem() == null) {
            return null;
        }

        String value = ICONS_BY_STACK_KEY.get(stackKey(stack));
        return value != null && value.length() > 0 ? value : null;
    }

    public static void exportRegistryIconsThen(Runnable afterExport) {
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null) {
            afterExport.run();
            return;
        }

        Queue<ItemStack> stacks = collectExportStacks();
        RecipeExporterMod.log.info("GTNH 1.7.10 icon exporter queued " + stacks.size() + " item stacks.");
        minecraft.displayGuiScreen(new IconExportScreen(stacks, afterExport));
    }

    private static Queue<ItemStack> collectExportStacks() {
        Map<Item, Boolean> seenItems = new IdentityHashMap<Item, Boolean>();
        Map<String, ItemStack> uniqueStacks = new LinkedHashMap<String, ItemStack>();

        for (Object value : Item.itemRegistry) {
            if (value instanceof Item) {
                addItemVariants((Item) value, seenItems, uniqueStacks);
            }
        }

        return new ArrayDeque<ItemStack>(uniqueStacks.values());
    }

    @SuppressWarnings({ "rawtypes", "unchecked" })
    private static void addItemVariants(Item item, Map<Item, Boolean> seenItems, Map<String, ItemStack> stacks) {
        if (item == null || seenItems.put(item, Boolean.TRUE) != null) {
            return;
        }

        List variants = new ArrayList();
        for (CreativeTabs tab : CreativeTabs.creativeTabArray) {
            if (tab == null) {
                continue;
            }

            try {
                item.getSubItems(item, tab, variants);
            } catch (Throwable ignored) {
            }
        }

        if (variants.isEmpty()) {
            try {
                variants.add(new ItemStack(item, 1, 0));
            } catch (Throwable ignored) {
            }
        }

        for (Object variant : variants) {
            if (!(variant instanceof ItemStack)) {
                continue;
            }

            ItemStack stack = ((ItemStack) variant).copy();
            stack.stackSize = 1;
            if (stack.getItem() == null) {
                continue;
            }
            stacks.put(stackKey(stack), stack);
        }
    }

    private static final class IconExportScreen extends GuiScreen {

        private final Queue<ItemStack> stacks;
        private final Runnable afterExport;
        private final File outDir;
        private int processed;
        private int exported;
        private boolean done;

        private IconExportScreen(Queue<ItemStack> stacks, Runnable afterExport) {
            this.stacks = stacks;
            this.afterExport = afterExport;
            this.outDir = iconDir();
        }

        @Override
        public void initGui() {
            if (!outDir.exists() && !outDir.mkdirs()) {
                RecipeExporterMod.log.warn("GTNH 1.7.10 icon exporter could not create " + outDir);
                done = true;
            }
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            if (done) {
                finish();
                return;
            }

            for (int i = 0; i < EXPORT_BATCH_SIZE && !stacks.isEmpty(); i++) {
                exportOne(stacks.poll());
            }

            if (stacks.isEmpty()) {
                done = true;
                finish();
            }
        }

        private void exportOne(ItemStack stack) {
            processed++;

            try {
                String key = stackKey(stack);
                String filename = safeName(stack) + "-" + sha1(key).substring(0, 12) + ".png";
                File outFile = new File(outDir, filename);

                drawRect(0, 0, ICON_SIZE, ICON_SIZE, BACKGROUND_COLOR);
                RenderHelper.enableGUIStandardItemLighting();
                GL11.glEnable(GL12.GL_RESCALE_NORMAL);
                FontRenderer fontRenderer = stack.getItem().getFontRenderer(stack);
                if (fontRenderer == null) {
                    fontRenderer = mc.fontRenderer;
                }
                RENDER_ITEM.renderItemIntoGUI(fontRenderer, mc.getTextureManager(), stack, 8, 8);
                RenderHelper.disableStandardItemLighting();
                GL11.glDisable(GL12.GL_RESCALE_NORMAL);
                GL11.glFlush();

                BufferedImage image = readGuiRegion(0, 0, ICON_SIZE, ICON_SIZE);
                makeBackgroundTransparent(image);
                if (!imageHasVisiblePixels(image) || missingTextureRatio(image) > 0.5D) {
                    ICONS_BY_STACK_KEY.put(key, "");
                    return;
                }

                ImageIO.write(image, "png", outFile);
                ICONS_BY_STACK_KEY.put(key, filename);
                exported++;
            } catch (Throwable t) {
                RecipeExporterMod.log.warn("GTNH 1.7.10 icon exporter failed for " + stack + ": " + t.toString());
            }
        }

        private void finish() {
            writeIconMap();
            RecipeExporterMod.log.info(
                "GTNH 1.7.10 icon exporter finished: " + exported + " icons exported from " + processed + " stacks."
            );
            mc.displayGuiScreen(null);
            afterExport.run();
        }
    }

    private static BufferedImage readGuiRegion(int guiX, int guiY, int guiWidth, int guiHeight) {
        Minecraft minecraft = Minecraft.getMinecraft();
        ScaledResolution scaled = new ScaledResolution(minecraft, minecraft.displayWidth, minecraft.displayHeight);
        int scaleFactor = Math.max(1, scaled.getScaleFactor());
        int pixelX = guiX * scaleFactor;
        int pixelY = minecraft.displayHeight - ((guiY + guiHeight) * scaleFactor);
        int pixelWidth = guiWidth * scaleFactor;
        int pixelHeight = guiHeight * scaleFactor;

        java.nio.ByteBuffer buffer = BufferUtils.createByteBuffer(pixelWidth * pixelHeight * 4);
        GL11.glReadPixels(pixelX, pixelY, pixelWidth, pixelHeight, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);

        BufferedImage image = new BufferedImage(guiWidth, guiHeight, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < guiHeight; y++) {
            for (int x = 0; x < guiWidth; x++) {
                int sourceX = Math.min(pixelWidth - 1, x * scaleFactor + scaleFactor / 2);
                int sourceY = Math.min(pixelHeight - 1, (guiHeight - 1 - y) * scaleFactor + scaleFactor / 2);
                int index = (sourceX + sourceY * pixelWidth) * 4;
                int red = buffer.get(index) & 255;
                int green = buffer.get(index + 1) & 255;
                int blue = buffer.get(index + 2) & 255;
                int alpha = buffer.get(index + 3) & 255;
                image.setRGB(x, y, (alpha << 24) | (red << 16) | (green << 8) | blue);
            }
        }

        return image;
    }

    private static void makeBackgroundTransparent(BufferedImage image) {
        int background = BACKGROUND_COLOR & 0x00FFFFFF;
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                int value = image.getRGB(x, y);
                if ((value & 0x00FFFFFF) == background) {
                    image.setRGB(x, y, 0);
                }
            }
        }
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

    private static double missingTextureRatio(BufferedImage image) {
        int visiblePixels = 0;
        int missingTexturePixels = 0;
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                int value = image.getRGB(x, y);
                int alpha = (value >>> 24) & 255;
                if (alpha == 0) {
                    continue;
                }

                visiblePixels++;
                int red = (value >> 16) & 255;
                int green = (value >> 8) & 255;
                int blue = value & 255;
                if (red >= 220 && green <= 40 && blue >= 220) {
                    missingTexturePixels++;
                }
            }
        }

        return visiblePixels > 0 ? (double) missingTexturePixels / (double) visiblePixels : 0.0D;
    }

    private static File iconDir() {
        String configured = System.getProperty("recex.iconDir");
        if (configured != null && configured.trim().length() > 0) {
            return new File(configured);
        }
        return new File(Minecraft.getMinecraft().mcDataDir, "RecEx-Rendered-Icons");
    }

    private static void writeIconMap() {
        File file = new File(iconDir(), "icon-map.json");
        FileWriter writer = null;
        try {
            writer = new FileWriter(file);
            writer.write("{\n");
            int index = 0;
            for (Map.Entry<String, String> entry : ICONS_BY_STACK_KEY.entrySet()) {
                if (index > 0) {
                    writer.write(",\n");
                }
                writer.write("  \"" + jsonEscape(entry.getKey()) + "\": \"" + jsonEscape(entry.getValue()) + "\"");
                index++;
            }
            writer.write("\n}\n");
        } catch (IOException e) {
            RecipeExporterMod.log.warn("Could not write GTNH icon map.", e);
        } finally {
            if (writer != null) {
                try {
                    writer.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private static String stackKey(ItemStack stack) {
        String nbt = stack.hasTagCompound() ? stack.getTagCompound().toString() : "";
        return String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()))
            + "@" + stack.getItemDamage()
            + "#" + nbt;
    }

    private static String safeName(ItemStack stack) {
        String raw;
        try {
            raw = String.valueOf(stack.getDisplayName());
        } catch (Throwable t) {
            raw = String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()));
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

    private static String jsonEscape(String value) {
        return String.valueOf(value)
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }
}
