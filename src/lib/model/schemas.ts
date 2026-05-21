import { z } from "zod";
import { PROJECT_SCHEMA_VERSION } from "./types";

export const resourceKindSchema = z.enum(["item", "fluid"]);
export const resourceIconAtlasRefSchema = z.object({
  imagePath: z.string().min(1),
  atlasWidth: z.number().int().positive(),
  atlasHeight: z.number().int().positive(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const factoryNodeColorTagSchema = z.enum([
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
]);

export const resourceAmountSchema = z.object({
  kind: resourceKindSchema,
  id: z.string().min(1, "Resource id is required"),
  amount: z.number().positive("Amount must be greater than zero"),
  displayName: z.string().min(1).optional(),
  iconPath: z.string().min(1).optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  modId: z.string().min(1).optional(),
  tooltip: z.array(z.string()).optional(),
  neiSlot: z
    .object({
      x: z.number().int().min(0),
      y: z.number().int().min(0),
    })
    .optional(),
});

export const recipeInputSchema = resourceAmountSchema.extend({
  optional: z.boolean().optional(),
  consumed: z.boolean().optional(),
});

export const recipeOutputSchema = resourceAmountSchema.extend({
  chance: z.number().min(0).max(1).optional(),
  byproduct: z.boolean().optional(),
});

export const machineProfileSchema = z.object({
  machineType: z.string().min(1),
  minimumTier: z.string().min(1),
  maxParallel: z.number().positive().optional(),
  eutLimit: z.number().positive().optional(),
  notes: z.string().optional(),
});

export const recipeSchema = z.object({
  id: z.string().min(1, "Recipe id is required"),
  name: z.string().min(1, "Recipe name is required"),
  machineType: z.string().min(1, "Machine type is required"),
  minimumTier: z.string().min(1, "Minimum tier is required"),
  durationTicks: z.number().int().positive("Duration must be at least 1 tick"),
  eut: z.number().min(0, "EU/t must be zero or positive"),
  inputs: z.array(recipeInputSchema),
  outputs: z.array(recipeOutputSchema).min(1, "At least one output is required"),
  programmedCircuit: z.string().optional(),
  notes: z.string().optional(),
  machineProfile: machineProfileSchema.optional(),
  isDemo: z.boolean().optional(),
  source: z
    .object({
      datasetVersionId: z.string().optional(),
      recipeMap: z.string().optional(),
      exporter: z.enum(["nesql", "recex", "nerd", "unknown"]).optional(),
      rawRecipeId: z.string().optional(),
    })
    .optional(),
  nei: z
    .object({
      iconPath: z.string().optional(),
      itemInputGrid: z.object({ width: z.number(), height: z.number() }).optional(),
      itemOutputGrid: z.object({ width: z.number(), height: z.number() }).optional(),
      fluidInputGrid: z.object({ width: z.number(), height: z.number() }).optional(),
      fluidOutputGrid: z.object({ width: z.number(), height: z.number() }).optional(),
      slotCapacity: z
        .object({
          maxItemInputs: z.number().int().min(0).optional(),
          maxItemOutputs: z.number().int().min(0).optional(),
          maxFluidInputs: z.number().int().min(0).optional(),
          maxFluidOutputs: z.number().int().min(0).optional(),
        })
        .optional(),
      additionalInfo: z.array(z.string()).optional(),
      requiresCleanroom: z.boolean().optional(),
      requiresLowGravity: z.boolean().optional(),
    })
    .optional(),
});

export const targetRateSchema = z.object({
  kind: resourceKindSchema,
  resourceId: z.string().min(1),
  amountPerSecond: z.number().positive("Target rate must be greater than zero"),
  displayName: z.string().optional(),
});

export const factoryNodeSchema = z.object({
  id: z.string().min(1),
  recipeId: z.string().min(1),
  colorTag: factoryNodeColorTagSchema.optional(),
  machineCount: z.number().min(0),
  parallel: z.number().positive(),
  overclockTier: z.string().min(1),
  targetOutput: targetRateSchema.optional(),
  enabled: z.boolean(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const factoryStorageSchema = z.object({
  id: z.string().min(1),
  kind: resourceKindSchema,
  resourceId: z.string().min(1),
  displayName: z.string().optional(),
  iconPath: z.string().optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  capacity: z.number().positive().optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const factoryEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  resourceKind: resourceKindSchema,
  resourceId: z.string().min(1),
  label: z.string().optional(),
  ratePerSecond: z.number().positive().optional(),
});

export const fuelProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    fuelFluidId: z.string().min(1),
    euPerLiter: z.number().positive().optional(),
    euPerBucket: z.number().positive().optional(),
    isDemo: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .refine((fuel) => fuel.euPerLiter !== undefined || fuel.euPerBucket !== undefined, {
    message: "Fuel profile needs euPerLiter or euPerBucket",
    path: ["euPerLiter"],
  });

export const factoryProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  targetRate: targetRateSchema.optional(),
  recipes: z.array(recipeSchema),
  nodes: z.array(factoryNodeSchema),
  storages: z.array(factoryStorageSchema).optional().default([]),
  edges: z.array(factoryEdgeSchema),
  fuelProfiles: z.array(fuelProfileSchema),
  selectedFuelProfileId: z.string().optional(),
  notes: z.string().optional(),
  metadata: z
    .object({
      isDemo: z.boolean().optional(),
      source: z.string().optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
});

export type FactoryProjectInput = z.input<typeof factoryProjectSchema>;
