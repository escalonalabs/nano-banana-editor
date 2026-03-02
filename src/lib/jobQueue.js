const EventEmitter = require('node:events');
const { nowIso } = require('./db');

class JobQueue extends EventEmitter {
  constructor({ db, processJob, concurrency = 1, pollMs = 120 }) {
    super();
    this.db = db;
    this.processJob = processJob;
    this.concurrency = Math.max(1, concurrency);
    this.pollMs = pollMs;
    this.active = 0;
    this.timer = null;

    this.selectNextStmt = db.prepare(`
      SELECT *
      FROM jobs
      WHERE status = 'queued' AND available_at <= ?
      ORDER BY created_at ASC
      LIMIT 1
    `);

    this.markProcessingStmt = db.prepare(`
      UPDATE jobs
      SET status = 'processing', progress = 0.05, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `);

    this.updateProgressStmt = db.prepare(`
      UPDATE jobs
      SET progress = ?, updated_at = ?
      WHERE id = ?
    `);

    this.completeStmt = db.prepare(`
      UPDATE jobs
      SET status = 'completed', progress = 1, result_json = ?, error = NULL, updated_at = ?
      WHERE id = ?
    `);

    this.retryStmt = db.prepare(`
      UPDATE jobs
      SET status = 'queued', retries = ?, available_at = ?, error = ?, updated_at = ?
      WHERE id = ?
    `);

    this.failStmt = db.prepare(`
      UPDATE jobs
      SET status = 'failed', error = ?, updated_at = ?
      WHERE id = ?
    `);
  }

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.pollMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick() {
    while (this.active < this.concurrency) {
      const row = this.selectNextStmt.get(Date.now());
      if (!row) {
        return;
      }

      const updated = this.markProcessingStmt.run(nowIso(), row.id);
      if (!updated.changes) {
        return;
      }

      this.active += 1;
      this.emit('job:update', { jobId: row.id });

      this.runOne(row).finally(() => {
        this.active -= 1;
      });
    }
  }

  async runOne(row) {
    const jobId = row.id;
    const input = JSON.parse(row.input_json);

    try {
      const result = await this.processJob(jobId, input, (progress) => {
        this.updateProgressStmt.run(progress, nowIso(), jobId);
        this.emit('job:update', { jobId });
      });

      this.completeStmt.run(JSON.stringify(result), nowIso(), jobId);
      this.emit('job:update', { jobId });
    } catch (error) {
      const retries = Number(row.retries || 0);
      const message = error?.message || 'job failed';

      if (retries < 2) {
        const nextRetries = retries + 1;
        const backoffMs = 500 * (2 ** retries);
        this.retryStmt.run(nextRetries, Date.now() + backoffMs, message, nowIso(), jobId);
      } else {
        this.failStmt.run(message, nowIso(), jobId);
      }

      this.emit('job:update', { jobId });
    }
  }
}

module.exports = {
  JobQueue,
};
