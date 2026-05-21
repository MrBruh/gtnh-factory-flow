import type { FactoryNodeColorTag } from "@/lib/model/types";

export const GT_NODE_COLORS: Record<
  FactoryNodeColorTag,
  { swatch: string; header: string; border: string; shadow: string }
> = {
  white: { swatch: "#f0f0f0", header: "#d8d8d8", border: "#9f9f9f", shadow: "#f0f0f0" },
  orange: { swatch: "#f9801d", header: "#c96b1e", border: "#914811", shadow: "#f9801d" },
  magenta: { swatch: "#c74ebd", header: "#a8439f", border: "#7d2c76", shadow: "#c74ebd" },
  light_blue: { swatch: "#3ab3da", header: "#3294b5", border: "#1d708e", shadow: "#3ab3da" },
  yellow: { swatch: "#fed83d", header: "#c8a929", border: "#957912", shadow: "#fed83d" },
  lime: { swatch: "#80c71f", header: "#68a31c", border: "#487612", shadow: "#80c71f" },
  pink: { swatch: "#f38baa", header: "#c66f89", border: "#955168", shadow: "#f38baa" },
  gray: { swatch: "#474f52", header: "#565e61", border: "#33383a", shadow: "#474f52" },
  light_gray: { swatch: "#9d9d97", header: "#85857f", border: "#62625e", shadow: "#9d9d97" },
  cyan: { swatch: "#169c9c", header: "#168282", border: "#0e6262", shadow: "#169c9c" },
  purple: { swatch: "#8932b8", header: "#74309a", border: "#562172", shadow: "#8932b8" },
  blue: { swatch: "#3c44aa", header: "#38408c", border: "#252b68", shadow: "#3c44aa" },
  brown: { swatch: "#835432", header: "#70482d", border: "#50331f", shadow: "#835432" },
  green: { swatch: "#5e7c16", header: "#536c16", border: "#394b0d", shadow: "#5e7c16" },
  red: { swatch: "#b02e26", header: "#962a24", border: "#6f1c18", shadow: "#b02e26" },
  black: { swatch: "#1d1d21", header: "#303033", border: "#111114", shadow: "#1d1d21" },
};

export const GT_NODE_COLOR_TAGS = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
] satisfies FactoryNodeColorTag[];

export const GT_NODE_COLOR_PALETTE: Array<{
  tag: FactoryNodeColorTag;
  color: (typeof GT_NODE_COLORS)[FactoryNodeColorTag];
}> = GT_NODE_COLOR_TAGS.map((tag) => ({
  tag,
  color: GT_NODE_COLORS[tag],
}));
