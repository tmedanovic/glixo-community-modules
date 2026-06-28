const http = require('node:http');

const moduleId = process.env.GLIXO_MODULE_ID || 'glixo.samples.memory-inspector';
const componentId = process.env.GLIXO_MODULE_COMPONENT_ID || 'memory-inspector-view';
const port = Number(process.env.PORT || process.env.GLIXO_HEALTH_PORT || 0);

console.log(`[${moduleId}/${componentId}] Memory Inspector sample started.`);
console.log('Read-only: surfaces saved agent memory via the AgentMemoryPanel sidebar and the list_saved_memory tool. Secrets are never returned.');

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', moduleId, componentId }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'not_found' }));
});

server.listen(port, () => {
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  console.log(`[${moduleId}/${componentId}] health endpoint listening on /health (port ${boundPort}).`);
});
