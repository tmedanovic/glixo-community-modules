# Machine Status Agent

Selected-machine helper for the Machine Status Board sample.

It logs a heartbeat and exposes `/health` from a local Node HTTP server. The
helper is safe by design: it reads process and machine identity hints, then
reports status without changing the target machine.
