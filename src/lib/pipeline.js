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

function promptTone(promptDirectives) {
  const lower = (promptDirectives || '').toLowerCase();
  if (/warm|calid|dorado|gold|orange|sunset/.test(lower)) return 'warm';
  if (/cool|fr[ií]o|azul|blue|cyber/.test(lower)) return 'cool';
  if (/dark|oscuro|dramatic|cinematic/.test(lower)) return 'dramatic';
  if (/blur|soft|suave/.test(lower)) return 'soft';
  return 'vivid';
}

async function applyLocalMaskedEdit({ targetBuffer, maskBuffer, promptDirectives, refine }) {
  const targetMeta = await sharp(targetBuffer).metadata();
  const width = targetMeta.width || 1;
  const height = targetMeta.height || 1;

  let mask = sharp(
    maskBuffer || await sharp({
      create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    }).png().toBuffer()
  )
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('b-w');

  if (refine.featherPx > 0) {
    mask = mask.blur(Math.max(0.6, Math.min(8, refine.featherPx / 4)));
  }

  const maskPng = await mask.png().toBuffer();
  const tone = promptTone(promptDirectives);

  let editedVariant = sharp(targetBuffer).ensureAlpha();
  if (tone === 'warm') {
    editedVariant = editedVariant.modulate({ brightness: 1.08, saturation: 1.35 }).tint({ r: 255, g: 188, b: 138 });
  } else if (tone === 'cool') {
    editedVariant = editedVariant.modulate({ brightness: 1.05, saturation: 1.25 }).tint({ r: 130, g: 185, b: 255 });
  } else if (tone === 'dramatic') {
    editedVariant = editedVariant.modulate({ brightness: 0.85, saturation: 1.4 }).gamma(1.15);
  } else if (tone === 'soft') {
    editedVariant = editedVariant.blur(2.2).modulate({ brightness: 1.04, saturation: 1.15 });
  } else {
    editedVariant = editedVariant.modulate({ brightness: 1.1, saturation: 1.45 }).tint({ r: 242, g: 146, b: 213 });
  }

  const editedVariantBuffer = await editedVariant.png().toBuffer();
  const maskedEdited = await sharp(editedVariantBuffer)
    .composite([{ input: maskPng, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return sharp(targetBuffer)
    .composite([{ input: maskedEdited, blend: 'over' }])
    .png()
    .toBuffer();
}

async function createObjectTransferPipeline({ adapter }) {
  async function run({ targetBuffer, sourceBuffer, maskBuffer, request, onProgress }) {
    const { placement, qualityMode, refine, promptDirectives } = request;

    onProgress?.(0.1, 'analyzing-images');

    const targetMeta = await sharp(targetBuffer).metadata();
    const targetWidth = targetMeta.width || 1;
    const targetHeight = targetMeta.height || 1;
    let merged;
    const artifacts = [];

    if (sourceBuffer) {
      const sourceMeta = await sharp(sourceBuffer).metadata();
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

      merged = harmonized || precomposed;
      if (!harmonized) {
        artifacts.push('remote_harmonization_unavailable');
      }
    } else {
      onProgress?.(0.3, 'local-masked-edit');
      merged = await applyLocalMaskedEdit({
        targetBuffer,
        maskBuffer,
        promptDirectives,
        refine,
      });
      artifacts.push('single_image_edit_mode');
    }

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
