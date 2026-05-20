package com.bigbass.recex.icons;

import java.awt.image.BufferedImage;
import java.awt.Graphics2D;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.imageio.ImageIO;

import com.bigbass.recex.RecipeExporterMod;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.FontRenderer;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.renderer.RenderHelper;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.client.renderer.entity.RenderItem;
import net.minecraft.client.shader.Framebuffer;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;

public final class ClientItemStackIconRenderer {

    private static final int ICON_SIZE = Integer.getInteger("recex.iconSize", 64);
    private static final int GUI_ICON_CANVAS_SIZE = 32;
    private static final int GUI_ITEM_SIZE = 16;
    private static final int MAX_RENDER_WARNINGS = Integer.getInteger("recex.maxIconRenderWarnings", 50);
    private static final Map<String, String> ICONS_BY_STACK_KEY = new LinkedHashMap<String, String>();
    private static final RenderItem RENDER_ITEM = new RenderItem();
    private static int renderWarnings;

    private ClientItemStackIconRenderer() {}

    public static String lookupIcon(ItemStack stack) {
        return captureIcon(stack);
    }

    public static String captureIcon(ItemStack stack) {
        if (stack == null || stack.getItem() == null || stack.stackSize <= 0) {
            return null;
        }

        String key = stackKey(stack);
        if (ICONS_BY_STACK_KEY.containsKey(key)) {
            String value = ICONS_BY_STACK_KEY.get(key);
            return value != null && value.length() > 0 ? value : null;
        }

        File outDir = iconDir();
        if (!outDir.exists() && !outDir.mkdirs()) {
            ICONS_BY_STACK_KEY.put(key, "");
            return null;
        }

        try {
            ItemStack renderStack = stack.copy();
            renderStack.stackSize = 1;
            String filename = safeName(renderStack) + "-" + sha1(key).substring(0, 12) + ".png";
            File outFile = new File(outDir, filename);

            if (!outFile.isFile()) {
                BufferedImage image = renderStackToImage(renderStack);
                applyMissingItemTint(renderStack, image);
                image = renderWithEmptyCellBaseIfNeeded(renderStack, image);
                if (!imageHasVisiblePixels(image) || missingTextureRatio(image) > 0.5D) {
                    ICONS_BY_STACK_KEY.put(key, "");
                    return null;
                }
                ImageIO.write(image, "png", outFile);
            }

            ICONS_BY_STACK_KEY.put(key, filename);
            return filename;
        } catch (Throwable t) {
            ICONS_BY_STACK_KEY.put(key, "");
            warnRenderFailure(stack, t);
            return null;
        } finally {
            RenderHelper.disableStandardItemLighting();
            GL11.glDisable(GL12.GL_RESCALE_NORMAL);
            resetTessellator();
        }
    }

    public static void exportRegistryIconsThen(Runnable afterExport) {
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null) {
            afterExport.run();
            return;
        }

        RecipeExporterMod.log.info("GTNH 1.7.10 icon exporter is ready for on-demand ItemStack rendering.");
        minecraft.displayGuiScreen(new IconExportScreen(afterExport));
    }

    private static BufferedImage renderStackToImage(ItemStack stack) throws Exception {
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null || minecraft.getTextureManager() == null) {
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
            GL11.glOrtho(0.0D, GUI_ICON_CANVAS_SIZE, GUI_ICON_CANVAS_SIZE, 0.0D, 1000.0D, 3000.0D);

            GL11.glMatrixMode(GL11.GL_MODELVIEW);
            GL11.glPushMatrix();
            modelViewPushed = true;
            GL11.glLoadIdentity();
            GL11.glTranslatef(0.0F, 0.0F, -2000.0F);

            RenderHelper.enableGUIStandardItemLighting();
            GL11.glEnable(GL12.GL_RESCALE_NORMAL);
            FontRenderer fontRenderer = stack.getItem().getFontRenderer(stack);
            if (fontRenderer == null) {
                fontRenderer = minecraft.fontRenderer;
            }
            RENDER_ITEM.renderItemIntoGUI(
                fontRenderer,
                minecraft.getTextureManager(),
                stack,
                (GUI_ICON_CANVAS_SIZE - GUI_ITEM_SIZE) / 2,
                (GUI_ICON_CANVAS_SIZE - GUI_ITEM_SIZE) / 2
            );
            RenderHelper.disableStandardItemLighting();
            GL11.glDisable(GL12.GL_RESCALE_NORMAL);
            resetTessellator();
            GL11.glFlush();

            buffer = BufferUtils.createByteBuffer(ICON_SIZE * ICON_SIZE * 4);
            GL11.glReadPixels(0, 0, ICON_SIZE, ICON_SIZE, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);
        } finally {
            RenderHelper.disableStandardItemLighting();
            GL11.glDisable(GL12.GL_RESCALE_NORMAL);
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

        return imageFromRgbaBuffer(buffer);
    }

    private static BufferedImage renderWithEmptyCellBaseIfNeeded(ItemStack stack, BufferedImage overlay) {
        if (!shouldRenderEmptyCellBase(stack)) {
            return overlay;
        }

        try {
            Item emptyCellItem = (Item) Item.itemRegistry.getObject("IC2:itemCellEmpty");
            if (emptyCellItem == null) {
                return overlay;
            }

            ItemStack emptyCell = new ItemStack(emptyCellItem, 1, 0);
            BufferedImage base = renderStackToImage(emptyCell);
            BufferedImage combined = new BufferedImage(overlay.getWidth(), overlay.getHeight(), BufferedImage.TYPE_INT_ARGB);
            Graphics2D graphics = combined.createGraphics();
            try {
                graphics.drawImage(base, 0, 0, null);
                graphics.drawImage(overlay, 0, 0, null);
            } finally {
                graphics.dispose();
            }
            return combined;
        } catch (Throwable ignored) {
            return overlay;
        }
    }

    private static boolean shouldRenderEmptyCellBase(ItemStack stack) {
        String displayName;
        try {
            displayName = String.valueOf(stack.getDisplayName());
        } catch (Throwable ignored) {
            return false;
        }

        if (!displayName.endsWith(" Cell") || "Empty Cell".equals(displayName)) {
            return false;
        }

        String registryName = String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()));
        return registryName.startsWith("gregtech:")
            || registryName.startsWith("IC2:")
            || registryName.startsWith("miscutils:");
    }

    private static final class IconExportScreen extends GuiScreen {

        private final Runnable afterExport;
        private boolean done;

        private IconExportScreen(Runnable afterExport) {
            this.afterExport = afterExport;
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            if (done) {
                return;
            }
            done = true;
            writeIconMap();
            RecipeExporterMod.log.info("GTNH 1.7.10 icon exporter finished initialisation.");
            mc.displayGuiScreen(null);
            afterExport.run();
        }
    }

    static BufferedImage imageFromRgbaBuffer(ByteBuffer buffer) {
        BufferedImage image = new BufferedImage(ICON_SIZE, ICON_SIZE, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < ICON_SIZE; y++) {
            for (int x = 0; x < ICON_SIZE; x++) {
                int index = (x + (ICON_SIZE - 1 - y) * ICON_SIZE) * 4;
                int red = buffer.get(index) & 255;
                int green = buffer.get(index + 1) & 255;
                int blue = buffer.get(index + 2) & 255;
                int alpha = buffer.get(index + 3) & 255;
                image.setRGB(x, y, (alpha << 24) | (red << 16) | (green << 8) | blue);
            }
        }
        return image;
    }

    static boolean imageHasVisiblePixels(BufferedImage image) {
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

    private static void applyMissingItemTint(ItemStack stack, BufferedImage image) {
        int color = stackTintColor(stack);
        if (color < 0) {
            return;
        }

        if ((color & 0x00FFFFFF) == 0x00FFFFFF || !imageLooksUntinted(image)) {
            return;
        }

        int tintRed = (color >> 16) & 255;
        int tintGreen = (color >> 8) & 255;
        int tintBlue = color & 255;

        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                int value = image.getRGB(x, y);
                int alpha = (value >>> 24) & 255;
                if (alpha == 0) {
                    continue;
                }

                int red = (((value >> 16) & 255) * tintRed) / 255;
                int green = (((value >> 8) & 255) * tintGreen) / 255;
                int blue = ((value & 255) * tintBlue) / 255;
                image.setRGB(x, y, (alpha << 24) | (red << 16) | (green << 8) | blue);
            }
        }
    }

    private static boolean imageLooksUntinted(BufferedImage image) {
        int visiblePixels = 0;
        int neutralPixels = 0;
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
                int max = Math.max(red, Math.max(green, blue));
                int min = Math.min(red, Math.min(green, blue));
                if (max - min <= 10) {
                    neutralPixels++;
                }
            }
        }

        return visiblePixels > 0 && (double) neutralPixels / (double) visiblePixels > 0.85D;
    }

    private static int stackTintColor(ItemStack stack) {
        int gregTechColor = gregTechMaterialColor(stack);
        if (gregTechColor >= 0) {
            return gregTechColor;
        }

        try {
            return stack.getItem().getColorFromItemStack(stack, 0) & 0x00FFFFFF;
        } catch (Throwable ignored) {
            return -1;
        }
    }

    private static int gregTechMaterialColor(ItemStack stack) {
        Object item = stack.getItem();
        Class<?> type = item.getClass();
        while (type != null) {
            int methodColor = gregTechMaterialColorFromMethod(item, type, stack);
            if (methodColor >= 0) {
                return methodColor;
            }

            int fieldColor = gregTechMaterialColorFromField(item, type, stack.getItemDamage());
            if (fieldColor >= 0) {
                return fieldColor;
            }
            type = type.getSuperclass();
        }

        return -1;
    }

    private static int gregTechMaterialColorFromMethod(Object item, Class<?> type, ItemStack stack) {
        String[] methodNames = new String[] { "getRGBa", "getRGBA" };
        for (String methodName : methodNames) {
            try {
                Method method = type.getDeclaredMethod(methodName, ItemStack.class);
                method.setAccessible(true);
                int color = colorFromRgbArray(method.invoke(item, stack));
                if (color >= 0) {
                    return color;
                }
            } catch (Throwable ignored) {
            }
        }

        return -1;
    }

    private static int gregTechMaterialColorFromField(Object item, Class<?> type, int meta) {
        try {
            Field field = type.getDeclaredField("mRGBa");
            field.setAccessible(true);
            Object table = field.get(item);
            if (table == null || !table.getClass().isArray() || meta < 0 || meta >= Array.getLength(table)) {
                return -1;
            }

            return colorFromRgbArray(Array.get(table, meta));
        } catch (Throwable ignored) {
            return -1;
        }
    }

    private static int colorFromRgbArray(Object value) {
        if (value == null || !value.getClass().isArray() || Array.getLength(value) < 3) {
            return -1;
        }

        int red = colorChannel(Array.get(value, 0));
        int green = colorChannel(Array.get(value, 1));
        int blue = colorChannel(Array.get(value, 2));
        if (red < 0 || green < 0 || blue < 0) {
            return -1;
        }

        return (red << 16) | (green << 8) | blue;
    }

    private static int colorChannel(Object value) {
        if (!(value instanceof Number)) {
            return -1;
        }
        int channel = ((Number) value).intValue();
        return Math.max(0, Math.min(255, channel));
    }

    static File iconDir() {
        String configured = System.getProperty("recex.iconDir");
        if (configured != null && configured.trim().length() > 0) {
            return new File(configured);
        }
        return new File(Minecraft.getMinecraft().mcDataDir, "RecEx-Rendered-Icons");
    }

    static void resetTessellator() {
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

    private static void warnRenderFailure(ItemStack stack, Throwable throwable) {
        renderWarnings++;
        if (renderWarnings <= MAX_RENDER_WARNINGS || renderWarnings % 1000 == 0) {
            RecipeExporterMod.log.warn(
                "GTNH 1.7.10 icon exporter failed for "
                    + stack
                    + " ("
                    + renderWarnings
                    + " failures): "
                    + throwable.toString()
            );
        }
    }

    static void writeIconMap() {
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

    static String sha1(String value) throws Exception {
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
