const fs = require('node:fs/promises');
const path = require('node:path');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

const { resolveConfig } = require('./config');
const { createDb, nowIso } = require('./lib/db');
const { storeBuffer, readBuffer, absoluteAssetPath } = require('./lib/cas');
const { objectTransferRequestSchema } = require('./lib/validation');
const { NanoBananaAdapter } = require('./lib/nanoBananaAdapter');
const { createObjectTransferPipeline } = require('./lib/pipeline');
const { JobQueue } = require('./lib/jobQueue');

dotenv.config();

function safeJsonParse(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapProject(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentSnapshotId: row.current_snapshot_id,
    redoStack: safeJsonParse(row.redo_stack_json, []),
  };
}

function mapAsset(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    hash: row.hash,
    casPath: row.cas_path,
    mime: row.mime,
    ext: row.ext,
    width: row.width,
    height: row.height,
    size: row.size,
    kind: row.kind,
    metadata: safeJsonParse(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function mapSnapshot(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    parentSnapshotId: row.parent_snapshot_id,
    operationType: row.operation_type,
    assetIds: safeJsonParse(row.asset_ids_json, {}),
    previewAssetId: row.preview_asset_id,
    metadata: safeJsonParse(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function mapJob(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    progress: Number(row.progress || 0),
    input: safeJsonParse(row.input_json, {}),
    result: safeJsonParse(row.result_json, null),
    error: row.error,
    retries: row.retries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createApp() {
  const config = resolveConfig();

  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.mkdir(config.casDir, { recursive: true });
  await fs.mkdir(config.exportsDir, { recursive: true });

  const db = createDb(config.dbPath);

  const selectProjectStmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  const selectAssetStmt = db.prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?');
  const selectAssetByIdStmt = db.prepare('SELECT * FROM assets WHERE id = ?');
  const selectSnapshotStmt = db.prepare('SELECT * FROM snapshots WHERE id = ? AND project_id = ?');
  const selectJobStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');

  const insertProjectStmt = db.prepare(`
    INSERT INTO projects (id, name, created_at, updated_at, current_snapshot_id, redo_stack_json)
    VALUES (?, ?, ?, ?, NULL, '[]')
  `);

  const insertAssetStmt = db.prepare(`
    INSERT INTO assets (
      id, project_id, hash, cas_path, mime, ext,
      width, height, size, kind, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const findAssetByHashStmt = db.prepare(`
    SELECT * FROM assets WHERE project_id = ? AND hash = ? AND mime = ?
  `);

  const insertJobStmt = db.prepare(`
    INSERT INTO jobs (
      id, project_id, type, status, progress,
      input_json, result_json, error, retries, available_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?)
  `);

  const insertSnapshotStmt = db.prepare(`
    INSERT INTO snapshots (
      id, project_id, parent_snapshot_id, operation_type,
      asset_ids_json, preview_asset_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertOperationStmt = db.prepare(`
    INSERT INTO operations (id, project_id, snapshot_id, type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const updateProjectCurrentSnapshotStmt = db.prepare(`
    UPDATE projects
    SET current_snapshot_id = ?, redo_stack_json = ?, updated_at = ?
    WHERE id = ?
  `);

  const adapter = new NanoBananaAdapter({
    apiKey: config.apiKey,
    disableRemote: config.disableRemote,
    model: config.nanoModel,
  });

  const pipeline = await createObjectTransferPipeline({ adapter });

  async function persistAsset({ projectId, buffer, mime, kind = 'generic', metadata = {} }) {
    const stored = await storeBuffer(config.casDir, buffer, mime);
    const existing = findAssetByHashStmt.get(projectId, stored.hash, mime);
    if (existing) {
      return mapAsset(existing);
    }

    let dimensions = { width: null, height: null };
    try {
      const sharpMeta = await sharp(buffer).metadata();
      dimensions = {
        width: sharpMeta.width || null,
        height: sharpMeta.height || null,
      };
    } catch {
      dimensions = { width: null, height: null };
    }

    const createdAt = nowIso();
    const assetId = uuidv4();

    insertAssetStmt.run(
      assetId,
      projectId,
      stored.hash,
      stored.casPath,
      mime,
      stored.ext,
      dimensions.width,
      dimensions.height,
      stored.size,
      kind,
      JSON.stringify(metadata),
      createdAt
    );

    return mapAsset(selectAssetStmt.get(assetId, projectId));
  }

  async function loadAssetBuffer(assetRow) {
    return readBuffer(config.casDir, assetRow.cas_path);
  }

  async function processObjectTransfer(jobId, input, onProgress) {
    const project = selectProjectStmt.get(input.projectId);
    if (!project) {
      throw new Error(`Project not found for job ${jobId}`);
    }

    const request = input.request;

    const targetAsset = selectAssetStmt.get(request.targetAssetId, input.projectId);
    const sourceAsset = request.sourceAssetId
      ? selectAssetStmt.get(request.sourceAssetId, input.projectId)
      : null;

    if (!targetAsset) {
      throw new Error('Target asset not found');
    }

    if (request.sourceAssetId && !sourceAsset) {
      throw new Error('Source asset not found');
    }

    const maskAsset = request.sourceMask?.assetId
      ? selectAssetStmt.get(request.sourceMask.assetId, input.projectId)
      : null;

    const [targetBuffer, sourceBuffer, maskBuffer] = await Promise.all([
      loadAssetBuffer(targetAsset),
      sourceAsset ? loadAssetBuffer(sourceAsset) : Promise.resolve(null),
      maskAsset ? loadAssetBuffer(maskAsset) : Promise.resolve(null),
    ]);

    onProgress(0.1);
    const result = await pipeline.run({
      targetBuffer,
      sourceBuffer,
      maskBuffer,
      request,
      onProgress,
    });

    onProgress(0.92);

    const [previewAsset, finalAsset] = await Promise.all([
      persistAsset({
        projectId: input.projectId,
        buffer: result.previewBuffer,
        mime: 'image/png',
        kind: 'preview',
        metadata: { fromJobId: jobId, qualityMode: request.qualityMode },
      }),
      persistAsset({
        projectId: input.projectId,
        buffer: result.finalBuffer,
        mime: 'image/png',
        kind: 'result',
        metadata: { fromJobId: jobId, qualityMode: request.qualityMode },
      }),
    ]);

    const snapshotId = uuidv4();
    const operationId = uuidv4();
    const createdAt = nowIso();

    db.transaction(() => {
      const freshProject = selectProjectStmt.get(input.projectId);
      const parentSnapshotId = freshProject.current_snapshot_id || null;

      insertSnapshotStmt.run(
        snapshotId,
        input.projectId,
        parentSnapshotId,
        'object-transfer',
        JSON.stringify({
          targetAssetId: request.targetAssetId,
          sourceAssetId: request.sourceAssetId || null,
          maskAssetId: request.sourceMask?.assetId || null,
          previewAssetId: previewAsset.id,
          candidateAssetIds: [finalAsset.id],
        }),
        previewAsset.id,
        JSON.stringify({
          qualityMode: request.qualityMode,
          qualityReport: result.qualityReport,
          promptDirectives: request.promptDirectives,
        }),
        createdAt
      );

      insertOperationStmt.run(
        operationId,
        input.projectId,
        snapshotId,
        'object-transfer',
        JSON.stringify(request),
        createdAt
      );

      updateProjectCurrentSnapshotStmt.run(snapshotId, JSON.stringify([]), createdAt, input.projectId);
    })();

    return {
      snapshotId,
      previewAssetId: previewAsset.id,
      finalCandidateAssetIds: [finalAsset.id],
      qualityReport: result.qualityReport,
    };
  }

  const queue = new JobQueue({
    db,
    processJob: processObjectTransfer,
    concurrency: config.workerConcurrency,
  });
  queue.start();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  if (config.localOnly) {
    app.use((req, res, next) => {
      const ip = req.ip || req.socket.remoteAddress || '';
      const trusted =
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        ip.startsWith('127.') ||
        ip.startsWith('::ffff:127.');

      if (!trusted) {
        return res.status(403).json({ error: 'Local-only API' });
      }
      return next();
    });
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxFileSizeBytes },
  });

  app.use(express.static(process.cwd()));

  app.get('/health', (req, res) => {
    res.json({ ok: true, status: 'healthy' });
  });

  app.post('/v1/projects', (req, res) => {
    const name = (req.body?.name || 'Untitled Project').toString().trim().slice(0, 120) || 'Untitled Project';
    const id = uuidv4();
    const timestamp = nowIso();

    insertProjectStmt.run(id, name, timestamp, timestamp);

    return res.status(201).json({
      project: mapProject(selectProjectStmt.get(id)),
    });
  });

  app.get('/v1/projects/:projectId', (req, res) => {
    const project = selectProjectStmt.get(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const mapped = mapProject(project);
    const snapshot = mapped.currentSnapshotId
      ? mapSnapshot(selectSnapshotStmt.get(mapped.currentSnapshotId, mapped.id))
      : null;

    return res.json({ project: mapped, currentSnapshot: snapshot });
  });

  app.post('/v1/projects/:projectId/assets', upload.single('asset'), async (req, res) => {
    try {
      const project = selectProjectStmt.get(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Asset file is required (field: asset)' });
      }

      if (!req.file.mimetype.startsWith('image/')) {
        return res.status(400).json({ error: 'Only image files are supported' });
      }

      const metadata = await sharp(req.file.buffer).metadata();
      if ((metadata.width || 0) > 4096 || (metadata.height || 0) > 4096) {
        return res.status(400).json({ error: 'Max resolution is 4096x4096 for MVP' });
      }

      const kind = (req.body?.kind || 'generic').toString().slice(0, 40);
      const asset = await persistAsset({
        projectId: req.params.projectId,
        buffer: req.file.buffer,
        mime: req.file.mimetype,
        kind,
        metadata: {
          originalName: req.file.originalname,
          uploadedAt: nowIso(),
        },
      });

      return res.status(201).json({ asset });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Unable to store asset' });
    }
  });

  app.get('/v1/projects/:projectId/assets/:assetId', (req, res) => {
    const asset = selectAssetStmt.get(req.params.assetId, req.params.projectId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    return res.json({ asset: mapAsset(asset) });
  });

  app.get('/v1/projects/:projectId/assets/:assetId/file', async (req, res) => {
    const asset = selectAssetStmt.get(req.params.assetId, req.params.projectId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const filePath = absoluteAssetPath(config.casDir, asset.cas_path);
    res.type(asset.mime);
    return res.sendFile(filePath, { dotfiles: 'allow' }, (error) => {
      if (!error) {
        return;
      }

      if (error.status === 404 || error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Asset file missing in storage' });
      }

      return res.status(500).json({ error: 'Unable to stream asset file' });
    });
  });

  app.post('/v1/projects/:projectId/operations/object-transfer', (req, res) => {
    const project = selectProjectStmt.get(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const parsed = objectTransferRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request payload',
        details: parsed.error.issues,
      });
    }

    const payload = parsed.data;
    if (payload.projectId !== req.params.projectId) {
      return res.status(400).json({ error: 'projectId mismatch with URL' });
    }

    const hasTarget = selectAssetStmt.get(payload.targetAssetId, req.params.projectId);
    if (!hasTarget) {
      return res.status(400).json({ error: 'targetAssetId must belong to the same project' });
    }

    if (payload.sourceAssetId) {
      const hasSource = selectAssetStmt.get(payload.sourceAssetId, req.params.projectId);
      if (!hasSource) {
        return res.status(400).json({ error: 'sourceAssetId must belong to the same project' });
      }
    }

    if (payload.sourceMask?.assetId) {
      const hasMask = selectAssetStmt.get(payload.sourceMask.assetId, req.params.projectId);
      if (!hasMask) {
        return res.status(400).json({ error: 'sourceMask.assetId not found in project' });
      }
    }

    const jobId = uuidv4();
    const createdAt = nowIso();

    insertJobStmt.run(
      jobId,
      req.params.projectId,
      'object-transfer',
      'queued',
      0,
      JSON.stringify({ projectId: req.params.projectId, request: payload }),
      Date.now(),
      createdAt,
      createdAt
    );

    queue.tick().catch(() => {});

    return res.status(202).json({
      job: mapJob(selectJobStmt.get(jobId)),
    });
  });

  app.get('/v1/jobs/:jobId', (req, res) => {
    const job = selectJobStmt.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.json({ job: mapJob(job) });
  });

  app.get('/v1/jobs/:jobId/stream', (req, res) => {
    const job = selectJobStmt.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const writeState = () => {
      const current = selectJobStmt.get(req.params.jobId);
      if (!current) {
        return;
      }
      res.write(`data: ${JSON.stringify({ job: mapJob(current) })}\n\n`);
    };

    writeState();

    const listener = ({ jobId }) => {
      if (jobId === req.params.jobId) {
        writeState();
      }
    };

    queue.on('job:update', listener);

    req.on('close', () => {
      queue.off('job:update', listener);
      res.end();
    });
  });

  app.get('/v1/projects/:projectId/snapshots/:snapshotId', (req, res) => {
    const snapshot = selectSnapshotStmt.get(req.params.snapshotId, req.params.projectId);
    if (!snapshot) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }

    return res.json({ snapshot: mapSnapshot(snapshot) });
  });

  app.post('/v1/projects/:projectId/history/undo', (req, res) => {
    const project = mapProject(selectProjectStmt.get(req.params.projectId));
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.currentSnapshotId) {
      return res.status(400).json({ error: 'No current snapshot to undo' });
    }

    const currentSnapshot = mapSnapshot(selectSnapshotStmt.get(project.currentSnapshotId, project.id));
    if (!currentSnapshot?.parentSnapshotId) {
      return res.status(400).json({ error: 'No parent snapshot to undo to' });
    }

    const nextRedo = [...project.redoStack, project.currentSnapshotId];
    updateProjectCurrentSnapshotStmt.run(currentSnapshot.parentSnapshotId, JSON.stringify(nextRedo), nowIso(), project.id);

    const updated = mapProject(selectProjectStmt.get(project.id));
    return res.json({
      project: updated,
      currentSnapshot: mapSnapshot(selectSnapshotStmt.get(updated.currentSnapshotId, updated.id)),
    });
  });

  app.post('/v1/projects/:projectId/history/redo', (req, res) => {
    const project = mapProject(selectProjectStmt.get(req.params.projectId));
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.redoStack.length) {
      return res.status(400).json({ error: 'Nothing to redo' });
    }

    const nextSnapshotId = project.redoStack[project.redoStack.length - 1];
    const nextRedo = project.redoStack.slice(0, -1);
    updateProjectCurrentSnapshotStmt.run(nextSnapshotId, JSON.stringify(nextRedo), nowIso(), project.id);

    const updated = mapProject(selectProjectStmt.get(project.id));
    return res.json({
      project: updated,
      currentSnapshot: mapSnapshot(selectSnapshotStmt.get(updated.currentSnapshotId, updated.id)),
    });
  });

  app.post('/v1/projects/:projectId/export', async (req, res) => {
    try {
      const project = mapProject(selectProjectStmt.get(req.params.projectId));
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const format = (req.body?.format || 'png').toLowerCase();
      if (!['png', 'jpeg', 'jpg', 'tiff'].includes(format)) {
        return res.status(400).json({ error: 'format must be png/jpeg/tiff' });
      }

      const snapshotId = req.body?.snapshotId || project.currentSnapshotId;
      if (!snapshotId) {
        return res.status(400).json({ error: 'No snapshot available for export' });
      }

      const snapshot = mapSnapshot(selectSnapshotStmt.get(snapshotId, project.id));
      if (!snapshot) {
        return res.status(404).json({ error: 'Snapshot not found' });
      }

      const candidateAssetId = req.body?.candidateAssetId || snapshot.assetIds?.candidateAssetIds?.[0] || snapshot.previewAssetId;
      if (!candidateAssetId) {
        return res.status(400).json({ error: 'Snapshot has no candidate asset' });
      }

      const asset = selectAssetStmt.get(candidateAssetId, project.id);
      if (!asset) {
        return res.status(404).json({ error: 'Candidate asset not found' });
      }

      const inputBuffer = await loadAssetBuffer(asset);
      let transformed = sharp(inputBuffer);
      if (format === 'png') transformed = transformed.png();
      if (format === 'jpeg' || format === 'jpg') transformed = transformed.jpeg({ quality: 95 });
      if (format === 'tiff') transformed = transformed.tiff({ quality: 95 });

      const outputBuffer = await transformed.toBuffer();

      const stamp = Date.now();
      const extension = format === 'jpg' ? 'jpeg' : format;
      const fileName = `${project.id}-${snapshot.id}-${stamp}.${extension}`;
      const outputPath = path.join(config.exportsDir, fileName);

      await fs.writeFile(outputPath, outputBuffer);

      return res.status(201).json({
        export: {
          projectId: project.id,
          snapshotId: snapshot.id,
          format: extension,
          filePath: outputPath,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Export failed' });
    }
  });

  app.get('/v1/metrics', (req, res) => {
    const totalProjects = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
    const totalAssets = db.prepare('SELECT COUNT(*) as c FROM assets').get().c;
    const jobsByStatus = db.prepare('SELECT status, COUNT(*) as c FROM jobs GROUP BY status').all();

    return res.json({
      projects: totalProjects,
      assets: totalAssets,
      jobs: jobsByStatus.reduce((acc, row) => {
        acc[row.status] = row.c;
        return acc;
      }, {}),
    });
  });

  app.get('/api/models', async (req, res) => {
    if (config.disableRemote || !config.apiKey) {
      return res.json({ success: true, models: [{ name: config.nanoModel, displayName: config.nanoModel }] });
    }

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey}`);
      const payload = await response.json();
      const models = (payload.models || [])
        .map((model) => model.name?.replace('models/', ''))
        .filter(Boolean)
        .map((name) => ({ name, displayName: name }));

      return res.json({ success: true, models });
    } catch {
      return res.json({ success: true, models: [{ name: config.nanoModel, displayName: config.nanoModel }] });
    }
  });

  app.locals.queue = queue;
  app.locals.db = db;
  app.locals.config = config;
  app.locals.shutdown = () => {
    queue.stop();
    db.close();
  };

  app.use((error, req, res, next) => {
    if (!error) {
      return next();
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    return res.status(status).json({ error: error.message || 'Internal server error' });
  });

  return app;
}

module.exports = {
  createApp,
};
