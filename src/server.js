const { createApp } = require('./app');

async function start() {
  const app = await createApp();
  const port = app.locals.config.port;

  const server = app.listen(port, () => {
    console.log(`Nano Banana Local API listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      if (app.locals.shutdown) {
        app.locals.shutdown();
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
