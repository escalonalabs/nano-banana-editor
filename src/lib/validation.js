const { z } = require('zod');

const sourceMaskSchema = z.object({
  kind: z.enum(['raster', 'vector']),
  assetId: z.string().optional(),
  path: z.string().optional(),
});

const placementSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number().positive(),
  rotationDeg: z.number(),
  perspective: z.array(z.number()).optional(),
});

const refineSchema = z.object({
  featherPx: z.number().min(0).max(256),
  relight: z.number().min(0).max(1),
  colorMatch: z.number().min(0).max(1),
  shadow: z.enum(['auto', 'off']),
});

const objectTransferRequestSchema = z.object({
  projectId: z.string(),
  targetAssetId: z.string(),
  sourceAssetId: z.string().optional(),
  sourceMask: sourceMaskSchema,
  placement: placementSchema,
  promptDirectives: z.string().min(1),
  qualityMode: z.enum(['preview', 'pro']),
  refine: refineSchema,
});

module.exports = {
  objectTransferRequestSchema,
};
