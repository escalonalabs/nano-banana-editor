const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');

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

test('v1 object transfer pipeline creates snapshot and candidate asset', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbe-test-'));
  process.env.NBE_DATA_DIR = tempDir;
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
});
