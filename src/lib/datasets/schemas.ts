import { z } from "zod";
import { dominantColorSchema, recipeSchema, resourceIconAtlasRefSchema } from "../model/schemas";

export const datasetSourceInfoSchema = z.object({
  sourceId: z.enum(["nesql", "recex", "nerd", "unknown"]),
  sourceVersion: z.string().optional(),
  generatedAt: z.string(),
  gitCommit: z.string().optional(),
  notes: z.string().optional(),
});

export const datasetResourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["item", "fluid"]),
  displayName: z.string().min(1),
  iconPath: z.string().optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  dominantColor: dominantColorSchema,
  modId: z.string().optional(),
  tooltip: z.array(z.string()).optional(),
  oreDictionary: z.array(z.string()).optional(),
  alternatives: z
    .array(
      z.object({
        kind: z.enum(["item", "fluid"]),
        id: z.string().min(1),
        displayName: z.string().min(1).optional(),
        iconPath: z.string().optional(),
        iconAtlas: resourceIconAtlasRefSchema.optional(),
        dominantColor: dominantColorSchema,
        modId: z.string().optional(),
        tooltip: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

export const datasetResourceIndexEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["item", "fluid"]),
  displayName: z.string().optional(),
  iconPath: z.string().optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  dominantColor: dominantColorSchema,
  recipeCount: z.number().int().min(0),
});

export const recipeDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  datasetVersionId: z.string().min(1),
  gtnhVersion: z.string().min(1),
  sourceInfo: datasetSourceInfoSchema,
  resources: z.array(datasetResourceSchema).default([]),
  resourceIndex: z.array(datasetResourceIndexEntrySchema).optional(),
  recipes: z.array(recipeSchema),
  oreDictionary: z.record(z.string(), z.array(z.string())),
  recipeMaps: z.array(z.string()),
  generatedAt: z.string(),
});

export const datasetVersionSchema = z.object({
  id: z.string().min(1),
  gtnhVersion: z.string().min(1),
  channel: z.enum(["stable", "daily", "experimental"]),
  publishedAt: z.string(),
  manifestPath: z.string(),
  recipeDatasetPath: z.string(),
  resourceIndexPath: z.string().optional(),
  recipeIndexPath: z.string().optional(),
  recipeLookupIndexPath: z.string().optional(),
  checksumSha256: z.string().optional(),
  sourceInfo: datasetSourceInfoSchema,
});

export const datasetManifestSchema = z.object({
  schemaVersion: z.literal(1),
  latestStableVersion: z.string().optional(),
  latestDailyVersion: z.string().optional(),
  versions: z.array(datasetVersionSchema),
});
