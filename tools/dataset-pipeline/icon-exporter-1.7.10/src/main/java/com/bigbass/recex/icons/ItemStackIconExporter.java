package com.bigbass.recex.icons;

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
            Method method = renderer.getMethod("lookupIcon", ItemStack.class);
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
        RecipeExporterMod.log.warn("GTNH 1.7.10 icon exporter is unavailable; continuing without item icons.", t);
    }
}
