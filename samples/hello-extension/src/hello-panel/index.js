const moduleId = process.env.GENIE_MODULE_ID || 'glixo.samples.hello-extension';
const componentId = process.env.GENIE_MODULE_COMPONENT_ID || 'hello-panel';

console.log(`[${moduleId}/${componentId}] Hello Extension sample started.`);
console.log('This sample is intentionally small: it proves catalog preview, zip install, policy acceptance, and lifecycle start/stop.');
