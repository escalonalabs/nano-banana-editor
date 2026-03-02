# Nano Banana Editor (Local-First MVP)

Local web editor for high-precision image transfer workflows with:

- Non-destructive snapshot history
- CAS asset storage
- SQLite metadata + job queue
- Hybrid pipeline (local pre/post + optional Nano Banana remote harmonization)

## Run

```bash
npm install
cp .env.example .env
npm start
```

Open: `http://localhost:3001`

## Test

```bash
npm test
```

## API v1

- `POST /v1/projects`
- `POST /v1/projects/:id/assets`
- `POST /v1/projects/:id/operations/object-transfer`
- `GET /v1/jobs/:jobId`
- `GET /v1/jobs/:jobId/stream`
- `GET /v1/projects/:id/snapshots/:snapshotId`
- `POST /v1/projects/:id/history/undo`
- `POST /v1/projects/:id/history/redo`
- `POST /v1/projects/:id/export`
- `GET /v1/metrics`

## Notes

- Local-only API is enabled by default (`NBE_LOCAL_ONLY=1`).
- Disable remote harmonization for local testing: `NBE_DISABLE_REMOTE=1`.
- Current MVP enforces image max size of 4096x4096.
