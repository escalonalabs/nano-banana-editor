const path = require('node:path');

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveConfig() {
  const cwd = process.cwd();
  const dataDir = process.env.NBE_DATA_DIR || path.join(cwd, '.nbe-data');

  return {
    port: toInt(process.env.PORT, 3001),
    dataDir,
    dbPath: path.join(dataDir, 'metadata.sqlite3'),
    casDir: path.join(dataDir, 'cas'),
    exportsDir: path.join(dataDir, 'exports'),
    maxFileSizeBytes: toInt(process.env.NBE_MAX_FILE_SIZE_BYTES, 50 * 1024 * 1024),
    workerConcurrency: Math.max(1, toInt(process.env.NBE_WORKER_CONCURRENCY, 1)),
    disableRemote: process.env.NBE_DISABLE_REMOTE === '1',
    nanoModel: process.env.NBE_NANO_MODEL || 'imagen-3.0-capability-001',
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    localOnly: process.env.NBE_LOCAL_ONLY !== '0',
  };
}

module.exports = {
  resolveConfig,
};
