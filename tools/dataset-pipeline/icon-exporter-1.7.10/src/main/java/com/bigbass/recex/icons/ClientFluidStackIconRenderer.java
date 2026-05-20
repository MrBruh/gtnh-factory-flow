package com.bigbass.recex.icons;

import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.imageio.ImageIO;

import com.bigbass.recex.RecipeExporterMod;

import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.client.renderer.texture.TextureMap;
import net.minecraft.client.shader.Framebuffer;
import net.minecraft.util.IIcon;
import net.minecraftforge.fluids.Fluid;
import net.minecraftforge.fluids.FluidStack;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;

public final class ClientFluidStackIconRenderer {

    private static final int ICON_SIZE = Integer.getInteger("recex.iconSize", 32);
    private static final int MAX_RENDER_WARNINGS = Integer.getInteger("recex.maxFluidIconRenderWarnings", 50);
    private static final Map<String, String> ICONS_BY_FLUID_KEY = new LinkedHashMap<String, String>();
    private static int renderWarnings;

    private ClientFluidStackIconRenderer() {}

    public static String captureIcon(FluidStack stack) {
        if (stack == null || stack.getFluid() == null) {
            return null;
        }

        String key = fluidKey(stack);
        if (ICONS_BY_FLUID_KEY.containsKey(key)) {
            String value = ICONS_BY_FLUID_KEY.get(key);
            return value != null && value.length() > 0 ? value : null;
        }

        File outDir = ClientItemStackIconRenderer.iconDir();
        if (!outDir.exists() && !outDir.mkdirs()) {
            ICONS_BY_FLUID_KEY.put(key, "");
            return null;
        }

        try {
            String filename = safeName(stack) + "-" + sha1(key).substring(0, 12) + ".png";
            File outFile = new File(outDir, filename);

            if (!outFile.isFile()) {
                BufferedImage image = renderFluidToImage(stack);
                if (!ClientItemStackIconRenderer.imageHasVisiblePixels(image)) {
                    ICONS_BY_FLUID_KEY.put(key, "");
                    return null;
                }
                ImageIO.write(image, "png", outFile);
            }

            ICONS_BY_FLUID_KEY.put(key, filename);
            return filename;
        } catch (Throwable t) {
            ICONS_BY_FLUID_KEY.put(key, "");
            warnRenderFailure(stack, t);
            return null;
        } finally {
            ClientItemStackIconRenderer.resetTessellator();
        }
    }

    private static BufferedImage renderFluidToImage(FluidStack stack) throws Exception {
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null || minecraft.getTextureManager() == null) {
            throw new IllegalStateException("Minecraft client is not ready.");
        }

        IIcon icon = fluidIcon(stack);
        if (icon == null) {
            throw new IllegalStateException("Fluid has no still icon: " + stack.getFluid().getName());
        }

        Framebuffer framebuffer = new Framebuffer(ICON_SIZE, ICON_SIZE, true);
        ByteBuffer buffer;
        boolean projectionPushed = false;
        boolean modelViewPushed = false;

        try {
            ClientItemStackIconRenderer.resetTessellator();
            framebuffer.bindFramebuffer(true);

            GL11.glViewport(0, 0, ICON_SIZE, ICON_SIZE);
            GL11.glClearColor(0.0F, 0.0F, 0.0F, 0.0F);
            GL11.glClear(GL11.GL_COLOR_BUFFER_BIT | GL11.GL_DEPTH_BUFFER_BIT);

            GL11.glMatrixMode(GL11.GL_PROJECTION);
            GL11.glPushMatrix();
            projectionPushed = true;
            GL11.glLoadIdentity();
            GL11.glOrtho(0.0D, ICON_SIZE, ICON_SIZE, 0.0D, -1.0D, 1.0D);

            GL11.glMatrixMode(GL11.GL_MODELVIEW);
            GL11.glPushMatrix();
            modelViewPushed = true;
            GL11.glLoadIdentity();

            minecraft.getTextureManager().bindTexture(TextureMap.locationBlocksTexture);
            int color = stack.getFluid().getColor(stack);
            float red = ((color >> 16) & 255) / 255.0F;
            float green = ((color >> 8) & 255) / 255.0F;
            float blue = (color & 255) / 255.0F;
            float alpha = ((color >>> 24) & 255) / 255.0F;
            if (alpha <= 0.0F) {
                alpha = 1.0F;
            }
            GL11.glColor4f(red, green, blue, alpha);

            double min = (ICON_SIZE - 16) / 2.0D;
            double max = min + 16.0D;
            Tessellator tessellator = Tessellator.instance;
            tessellator.startDrawingQuads();
            tessellator.addVertexWithUV(min, max, 0.0D, icon.getMinU(), icon.getMaxV());
            tessellator.addVertexWithUV(max, max, 0.0D, icon.getMaxU(), icon.getMaxV());
            tessellator.addVertexWithUV(max, min, 0.0D, icon.getMaxU(), icon.getMinV());
            tessellator.addVertexWithUV(min, min, 0.0D, icon.getMinU(), icon.getMinV());
            tessellator.draw();
            GL11.glColor4f(1.0F, 1.0F, 1.0F, 1.0F);
            GL11.glFlush();

            buffer = BufferUtils.createByteBuffer(ICON_SIZE * ICON_SIZE * 4);
            GL11.glReadPixels(0, 0, ICON_SIZE, ICON_SIZE, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);
        } finally {
            ClientItemStackIconRenderer.resetTessellator();
            GL11.glColor4f(1.0F, 1.0F, 1.0F, 1.0F);
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

        return ClientItemStackIconRenderer.imageFromRgbaBuffer(buffer);
    }

    private static IIcon fluidIcon(FluidStack stack) {
        Fluid fluid = stack.getFluid();
        IIcon icon = null;
        try {
            icon = fluid.getIcon(stack);
        } catch (Throwable ignored) {
            icon = null;
        }
        if (icon == null) {
            try {
                icon = fluid.getStillIcon();
            } catch (Throwable ignored) {
                icon = null;
            }
        }
        return icon;
    }

    private static void warnRenderFailure(FluidStack stack, Throwable throwable) {
        renderWarnings++;
        if (renderWarnings <= MAX_RENDER_WARNINGS || renderWarnings % 1000 == 0) {
            RecipeExporterMod.log.warn(
                "GTNH 1.7.10 fluid icon exporter failed for "
                    + stack.getFluid().getName()
                    + " ("
                    + renderWarnings
                    + " failures): "
                    + throwable.toString()
            );
        }
    }

    private static String fluidKey(FluidStack stack) {
        String nbt = stack.tag == null ? "" : stack.tag.toString();
        return stack.getFluid().getName() + "#" + nbt;
    }

    private static String safeName(FluidStack stack) {
        String raw;
        try {
            raw = String.valueOf(stack.getLocalizedName());
        } catch (Throwable t) {
            raw = stack.getFluid().getName();
        }
        String safe = raw.toLowerCase().replaceAll("[^a-z0-9._-]+", "_").replaceAll("^_+|_+$", "");
        return safe.length() > 0 ? safe.substring(0, Math.min(safe.length(), 60)) : "fluid";
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
