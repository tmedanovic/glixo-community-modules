const http = require('node:http');
const os = require('node:os');

const extensionId = process.env.GLIXO_MODULE_ID || 'glixo.samples.machine-status-board';
const componentId = process.env.GLIXO_MODULE_COMPONENT_ID || 'status-board-panel';
const label = process.env.GLIXO_MODULE_CONFIG_LABEL || 'Local machine status';

function createMachineStatusBoardModel(snapshot = {}) {
  const targets = Array.isArray(snapshot.targets) ? snapshot.targets : [];
  return {
    extensionId,
    title: 'Machine Status',
    emptyText: 'Select a machine to deploy the status helper.',
    targets: targets.map((target) => ({
      id: String(target.id || target.machineId || 'machine'),
      name: String(target.name || target.id || target.machineId || 'Machine'),
      status: String(target.status || target.healthStatus || 'unknown'),
      lastHeartbeat: target.lastHeartbeat || target.updatedAt || null,
    })),
  };
}

module.exports = { createMachineStatusBoardModel };

const startedAt = new Date();
const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    const body = JSON.stringify({
      ok: true,
      extensionId,
      componentId,
      label,
      host: os.hostname(),
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: startedAt.toISOString(),
      checkedAt: new Date().toISOString(),
      model: createMachineStatusBoardModel({
        targets: [{
          id: process.env.GLIXO_MACHINE_ID || os.hostname(),
          name: os.hostname(),
          status: 'client-ready',
          updatedAt: new Date().toISOString(),
        }],
      }),
    });
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(Number(process.env.PORT || process.env.GLIXO_MODULE_CONFIG_PORT || process.env.GLIXO_MODULE_HEALTH_PORT || 6120), '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 'unknown';
  console.log(`[${extensionId}/${componentId}] status board helper listening on 127.0.0.1:${port}/health`);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  server.close(() => {
    console.log(`[${extensionId}/${componentId}] stopped.`);
    process.exit(0);
  });
}
