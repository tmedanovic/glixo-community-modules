const moduleId = process.env.GLIXO_MODULE_ID || 'glixo.samples.machine-helper-vpn';
const componentId = process.env.GLIXO_MODULE_COMPONENT_ID || 'vpn-client-helper';
const targetMachineId = process.env.GLIXO_TARGET_MACHINE_ID || process.env.COMPUTERNAME || process.env.HOSTNAME || 'local-machine';

console.log(`[${moduleId}/${componentId}] VPN helper sample started for ${targetMachineId}.`);
console.log('This sample proves selected-machine placement, config policy, target logs, and uninstall cleanup without touching a real VPN client.');

setInterval(() => {
  console.log(`[${moduleId}/${componentId}] status=ready target=${targetMachineId}`);
}, 30_000);
