const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const sharp = require('sharp');

const PNG_16 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kJ8sAAAAASUVORK5CYII=',
  'base64'
);

async function postJson(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  return { response, payload };
}

async function uploadAsset(baseUrl, projectId, buffer, filename) {
  const formData = new FormData();
  formData.append('asset', new Blob([buffer], { type: 'image/png' }), filename);

  const response = await fetch(`${baseUrl}/v1/projects/${projectId}/assets`, {
    method: 'POST',
    body: formData,
  });

  const payload = await response.json();
  assert.equal(response.status, 201, payload.error || 'asset upload failed');
  assert.ok(payload.asset?.id);
  return payload.asset.id;
}

async function createAppServer(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbe-test-'));
  process.env.NBE_DATA_DIR = path.join(tempDir, '.nbe-data');
  process.env.NBE_DISABLE_REMOTE = '1';

  const { createApp } = require('../src/app');
  const app = await createApp();
  const server = app.listen(0);
  await once(server, 'listening');

  t.after(async () => {
    server.close();
    if (app.locals.shutdown) {
      app.locals.shutdown();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { baseUrl };
}

test('v1 object transfer pipeline creates snapshot and candidate asset', async (t) => {
  const { baseUrl } = await createAppServer(t);

  const createProject = await postJson(baseUrl, '/v1/projects', { name: 'test-project' });
  assert.equal(createProject.response.status, 201, createProject.payload.error || 'project create failed');
  assert.ok(createProject.payload.project?.id);
  const projectId = createProject.payload.project.id;

  const targetAssetId = await uploadAsset(baseUrl, projectId, PNG_16, 'target.png');
  const sourceAssetId = await uploadAsset(baseUrl, projectId, PNG_16, 'source.png');
  const maskAssetId = await uploadAsset(baseUrl, projectId, PNG_16, 'mask.png');

  const operation = await postJson(baseUrl, `/v1/projects/${projectId}/operations/object-transfer`, {
    projectId,
    targetAssetId,
    sourceAssetId,
    sourceMask: { kind: 'raster', assetId: maskAssetId },
    placement: { x: 8, y: 8, scale: 1, rotationDeg: 0 },
    promptDirectives: 'insert object with soft edge blending',
    qualityMode: 'preview',
    refine: { featherPx: 6, relight: 0.2, colorMatch: 0.5, shadow: 'auto' },
  });

  assert.equal(operation.response.status, 202, operation.payload.error || 'operation enqueue failed');
  assert.ok(operation.payload.job?.id);

  const jobId = operation.payload.job.id;

  let latest;
  for (let i = 0; i < 20; i += 1) {
    const jobResponse = await fetch(`${baseUrl}/v1/jobs/${jobId}`);
    latest = await jobResponse.json();
    if (latest.job?.status === 'completed') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.equal(latest.job?.status, 'completed', `job did not complete: ${JSON.stringify(latest)}`);
  assert.ok(latest.job.result?.snapshotId, 'snapshotId missing');
  assert.ok(Array.isArray(latest.job.result?.finalCandidateAssetIds));
  assert.ok(latest.job.result.finalCandidateAssetIds.length > 0);

  const snapshotResponse = await fetch(`${baseUrl}/v1/projects/${projectId}/snapshots/${latest.job.result.snapshotId}`);
  const snapshotPayload = await snapshotResponse.json();

  assert.equal(snapshotResponse.status, 200, snapshotPayload.error || 'snapshot fetch failed');
  assert.equal(snapshotPayload.snapshot.projectId, projectId);
  assert.equal(snapshotPayload.snapshot.operationType, 'object-transfer');

  const assetFileResponse = await fetch(`${baseUrl}/v1/projects/${projectId}/assets/${latest.job.result.finalCandidateAssetIds[0]}/file`);
  const assetFileBuffer = Buffer.from(await assetFileResponse.arrayBuffer());

  assert.equal(assetFileResponse.status, 200, 'asset file endpoint must serve binary file');
  assert.match(assetFileResponse.headers.get('content-type') || '', /image\/png/);
  assert.equal(assetFileBuffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'asset file must be PNG');
});

test('v1 should edit main image with mask and prompt even without secondary source image', async (t) => {
  const { baseUrl } = await createAppServer(t);

  const createProject = await postJson(baseUrl, '/v1/projects', { name: 'single-image-edit' });
  assert.equal(createProject.response.status, 201, createProject.payload.error || 'project create failed');
  const projectId = createProject.payload.project.id;

  const targetBuffer = await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 4,
      background: { r: 220, g: 225, b: 235, alpha: 1 },
    },
  }).png().toBuffer();

  const maskSvg = '<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="28" fill="white"/></svg>';
  const maskBuffer = await sharp(Buffer.from(maskSvg)).png().toBuffer();

  const targetAssetId = await uploadAsset(baseUrl, projectId, targetBuffer, 'target.png');
  const maskAssetId = await uploadAsset(baseUrl, projectId, maskBuffer, 'mask.png');

  const operation = await postJson(baseUrl, `/v1/projects/${projectId}/operations/object-transfer`, {
    projectId,
    targetAssetId,
    sourceMask: { kind: 'raster', assetId: maskAssetId },
    placement: { x: 64, y: 64, scale: 1, rotationDeg: 0 },
    promptDirectives: 'paint the masked area with a dramatic warm tone',
    qualityMode: 'preview',
    refine: { featherPx: 8, relight: 0.4, colorMatch: 0.7, shadow: 'auto' },
  });

  assert.equal(operation.response.status, 202, operation.payload.error || 'single-image operation should enqueue');

  const jobId = operation.payload.job.id;

  let latest;
  for (let i = 0; i < 40; i += 1) {
    const jobResponse = await fetch(`${baseUrl}/v1/jobs/${jobId}`);
    latest = await jobResponse.json();
    if (latest.job?.status === 'completed') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.equal(latest.job?.status, 'completed', `job did not complete: ${JSON.stringify(latest)}`);

  const finalAssetId = latest.job.result.finalCandidateAssetIds[0];
  const editedResponse = await fetch(`${baseUrl}/v1/projects/${projectId}/assets/${finalAssetId}/file`);
  assert.equal(editedResponse.status, 200, 'edited asset file must be downloadable');
  const editedBuffer = Buffer.from(await editedResponse.arrayBuffer());

  const original = await sharp(targetBuffer).raw().toBuffer();
  const edited = await sharp(editedBuffer).raw().toBuffer();
  assert.equal(original.length, edited.length, 'buffers should be comparable');

  let changedPixels = 0;
  for (let i = 0; i < original.length; i += 4) {
    const delta =
      Math.abs(original[i] - edited[i]) +
      Math.abs(original[i + 1] - edited[i + 1]) +
      Math.abs(original[i + 2] - edited[i + 2]);
    if (delta >= 20) {
      changedPixels += 1;
    }
  }

  assert.ok(changedPixels > 150, `expected visible edit; changedPixels=${changedPixels}`);
});
