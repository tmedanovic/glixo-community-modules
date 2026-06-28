Selected-machine VPN helper sample.

This target component is a safe stand-in for a VPN client helper. It starts as
a normal process, writes lifecycle logs, and reads only Glixo-provided runtime
environment variables so install, start, stop, logs, target placement, update,
and uninstall flows can be validated without connecting to a real VPN.
