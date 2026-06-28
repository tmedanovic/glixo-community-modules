const http = require('node:http');
const os = require('node:os');

const moduleId = process.env.GLIXO_MODULE_ID || 'glixo.samples.machine-status-board';
const componentId = process.env.GLIXO_MODULE_COMPONENT_ID || 'machine-status-agent';
const machineId = process.env.GLIXO_TARGET_MACHINE_ID
  || process.env.GLIXO_MACHINE_ID
  || process.env.COMPUTERNAME
  || process.env.HOSTNAME
  || os.hostname()
  || 'local-machine';
const label = process.env.GLIXO_MODULE_CONFIG_LABEL || 'Local machine status';
const heartbeatSeconds = parsePositiveInt(process.env.GLIXO_MODULE_CONFIG_HEARTBEATSECONDS, 15);
const includeEnvironment = String(process.env.GLIXO_MODULE_CONFIG_INCLUDEENVIRONMENT || 'true').toLowerCase() !== 'false';

const startedAt = new Date();
let heartbeatCount = 0;

function snapshot() {
  return {
    ok: true,
    moduleId,
    componentId,
    machineId,
    label,
    heartbeatCount,
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: startedAt.toISOString(),
    checkedAt: new Date().toISOString(),
    environment: includeEnvironment ? {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      host: os.hostname(),
    } : undefined,
  };
}

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    const body = JSON.stringify(snapshot());
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
  console.log(`[${moduleId}/${componentId}] health listening on 127.0.0.1:${port}/health`);
  console.log(`[${moduleId}/${componentId}] monitoring machine=${machineId} label="${label}" interval=${heartbeatSeconds}s`);
});

const timer = setInterval(() => {
  heartbeatCount += 1;
  const data = snapshot();
  console.log(`[${moduleId}/${componentId}] heartbeat=${data.heartbeatCount} machine=${data.machineId} uptime=${data.uptimeSeconds}s`);
}, heartbeatSeconds * 1000);

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  clearInterval(timer);
  server.close(() => {
    console.log(`[${moduleId}/${componentId}] stopped after ${heartbeatCount} heartbeat(s).`);
    process.exit(0);
  });
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
