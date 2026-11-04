> First deployment preparation now supersedes earlier deployment/bootstrap descriptions: [current guide](first-production-deployment.md). Use `compose.coolify.yaml` alone. `USER_NAME` is Telegram account configuration; migrations do not run on API startup. Prior test results below describe their dated local verification.

# Module 5 — Resource and streaming speed update

November 3, 2026. The owner explicitly superseded the earlier shared-VPS pilot resource allocations, requesting no fixed CPU/RAM quotas and fast playback. This updates repository code/configuration only. No deployment, VPS inspection or restart was performed.

## Changes

- Removed Hub `cpus`, reduced `cpu_shares`, `mem_limit` and `memswap_limit` settings from all four Hub services. The former aggregate 0.50-core/928-MiB allocation no longer applies.
- Removed Node's explicit 192-MiB old-space budget and Go's explicit 300-MiB GC memory target from Compose. Runtime/platform defaults still apply.
- Removed the API's 85%-memory-pressure playback rejection. Informational memory monitoring and warnings remain. The diagnostic helper is retained but no longer participates in admission.
- Removed the 262,144-byte/second production streaming pace. The Go production service no longer reads `STREAM_MAX_BYTES_PER_SECOND`, including an old value left in environment files. Media delivery has no application bitrate throttle; source availability, network throughput and client backpressure govern delivery.
- Removed the obsolete CPU/RAM/GC-budget and stream-pacing variables from `.env.example`. Updated the operations page and documentation to reflect the current policy.

Existing global viewer/upstream caps remain removed. The maximum of two simultaneous VIP sessions per account remains. Free classification/publication is still controlled by administrators without a new title limit. Per-session request ownership/fan-out and request-rate rules, bounded part reads, finite retries/deadlines, background workers, database pools, process-count safeguards and cancellation remain. Removing artificial CPU/RAM allocations does not require unbounded buffers or weakening authentication.

The generic streaming handler retains its optional pacing capability for older diagnostics/tests; production does not supply that option. Existing Range correctness/cancellation tests cover the unpaced default as well as the retained diagnostic option.

## Files

- `compose.yaml`: Hub resource quota/weight and runtime memory/pacing environment entries removed. Ports, routing, volumes, health checks, logging, PID limits and shutdown settings are unchanged.
- `.env.example`: retired resource/pacing settings removed.
- `services/api/src/playback.mjs`: memory-pressure admission call/import removed.
- `services/api/src/memory-pressure.mjs`: comment identifying the retained diagnostic helper.
- `services/stream-go/cmd/stream-service/main.go`: production pacing configuration and option removed.
- `apps/admin/src/Operations.jsx`: current resource-policy description.
- `README.md`, `docs/module5.md`, `docs/module5-capacity-update.md` and this report: current policy and historical context.

No migrations or database records were changed. Root `.env`, existing migrations, both proxy configuration files and the shared-Coolify overlay remain unchanged. Hub's Compose changes affect only its own service definitions and do not modify shared ingress or unrelated projects.

## Verification

| Check | Result |
| --- | --- |
| Node regression suite | 80 passed, 0 failed; 8 opt-in checks skipped |
| Go package suite | Passed; updated production service compiled |
| Public/admin production builds | Passed |
| Base and shared-Coolify merged Compose | Both validated; rendered service models contain no fixed CPU/RAM quotas, fixed Node/Go memory budgets or stream speed environment throttle |
| Module 5 isolated database/Node/Go playback regression | 10 passed, 0 failed, 0 skipped: per-account enforcement, concurrent streams/Range, authorization/revocation, recovery/cleanup, progress and administrator controls |

Database verification uses disposable schemas and synthetic media, not live application records. No load test, production deployment, actual-VPS benchmark or physical-device speed measurement was performed. Opt-in FFmpeg and backup checks were not repeated for these changes.

## Practical limits

Hub can compete for the VPS resources available to its containers. Removing its quotas can increase contention with the other projects under heavy demand. The VPS/parent cgroup, Node/Go runtime defaults, available RAM/CPU, database, bandwidth, browser codec compatibility and Telegram still impose real limits. Faster delivery is enabled by removing the artificial pace; uniformly fast playback and 10,000-viewer capacity have not been measured or guaranteed.
