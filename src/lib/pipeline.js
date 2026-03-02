const sharp = require('sharp');

async function applyMaskToSource(sourceBuffer, maskBuffer, width, height, featherPx) {
  let prepared = await sharp(sourceBuffer)
    .resize(width, height, { fit: 'contain' })
    .ensureAlpha()
    .png()
    .toBuffer();

  if (!maskBuffer) {
    return prepared;
  }

  let mask = sharp(maskBuffer)
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('b-w');

  if (featherPx > 0) {
    mask = mask.blur(Math.max(0.3, Math.min(5, featherPx / 8)));
  }

  const maskPng = await mask.png().toBuffer();

  return sharp(prepared)
    .composite([{ input: maskPng, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function createObjectTransferPipeline({ adapter }) {
  async function run({ targetBuffer, sourceBuffer, maskBuffer, request, onProgress }) {
    const { placement, qualityMode, refine, promptDirectives } = request;

    onProgress?.(0.1, 'analyzing-images');

    const targetMeta = await sharp(targetBuffer).metadata();
    const sourceMeta = await sharp(sourceBuffer).metadata();

    const targetWidth = targetMeta.width || 1;
    const targetHeight = targetMeta.height || 1;
    const sourceWidth = sourceMeta.width || 1;
    const sourceHeight = sourceMeta.height || 1;

    const scaledWidth = clamp(Math.round(sourceWidth * placement.scale), 1, targetWidth);
    const scaledHeight = clamp(Math.round(sourceHeight * placement.scale), 1, targetHeight);

    onProgress?.(0.25, 'building-cutout');
    const cutout = await applyMaskToSource(sourceBuffer, maskBuffer, scaledWidth, scaledHeight, refine.featherPx);

    const left = clamp(Math.round(placement.x - scaledWidth / 2), 0, Math.max(0, targetWidth - scaledWidth));
    const top = clamp(Math.round(placement.y - scaledHeight / 2), 0, Math.max(0, targetHeight - scaledHeight));

    onProgress?.(0.45, 'pre-compose');
    const precomposed = await sharp(targetBuffer)
      .composite([{ input: cutout, left, top, blend: 'over' }])
      .png()
      .toBuffer();

    onProgress?.(0.65, 'remote-harmonize');
    const harmonized = await adapter.harmonize({
      targetBuffer: precomposed,
      sourceBuffer: cutout,
      maskBuffer,
      promptDirectives,
      qualityMode,
    });

    const merged = harmonized || precomposed;

    onProgress?.(0.8, 'post-process');
    const postProcessed = await sharp(merged)
      .modulate({
        brightness: 1 + refine.relight * 0.05,
        saturation: 1 + refine.colorMatch * 0.04,
      })
      .png()
      .toBuffer();

    onProgress?.(0.9, 'preview');
    const preview = await sharp(postProcessed)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();

    const edgeScore = clamp(0.7 + refine.featherPx / 300, 0, 1);
    const colorDeltaE = Number((12 - refine.colorMatch * 8).toFixed(2));
    const artifacts = [];
    if (!harmonized) {
      artifacts.push('remote_harmonization_unavailable');
    }

    onProgress?.(1.0, 'completed');

    return {
      finalBuffer: postProcessed,
      previewBuffer: preview,
      qualityReport: {
        edgeScore: Number(edgeScore.toFixed(2)),
        colorDeltaE,
        artifacts,
      },
    };
  }

  return { run };
}

module.exports = {
  createObjectTransferPipeline,
};
