# Telegram connection reuse

The production stream service shares media connection pools across HTTP requests
and videos for the lifetime of one authenticated Telegram client. The pinned
gotd v0.163.0 dependency is unchanged: the implementation reuses its existing
`Client.Pool` / `Client.DC` transports rather than creating and closing a new
pool for each request. The first request to a data center still needs setup;
subsequent requests can use its established connections.

This is transport reuse only. No video segments are retained on the VPS or
added to browser storage. Each request still verifies its signed grant before
creating a backend, resolves current document metadata, and owns its reader,
file reference, position, deadline and cancellation. Existing VIP membership,
renewal/revocation, per-account session enforcement, leases, progress, Range
requests and analytics are unchanged. A request's backend close does not close
the shared pool or stop other viewers.

`TELEGRAM_FILE_CONNECTIONS` defaults to 32 reusable connections per data center
(valid values 1–256). Connections open lazily as concurrent part reads require
them. This controls transport parallelism, not playback admission: gotd waits
for a free connection rather than rejecting a viewer with a global-capacity
error. Existing per-read deadlines still apply. Increase the value only with
measurements of actual throughput, Telegram responses and infrastructure.
There is no global playback-session or reservation limit introduced here.

Pool initialization is shared once per DC, outside the map mutex. It has a
20-second deadline tied to the Telegram runtime, independent of any one viewer.
Cancelling a viewer stops its wait/read without cancelling another viewer's
setup. Failed setup is removed so the next request can retry. Different DCs
initialize independently. The existing bound of eight DC pool entries remains
a bound on data centers, not viewers or titles. gotd handles dead connections
inside its pools; file-reference refresh and bounded part retries are retained.

Disconnect, reconnect and service shutdown cancel setup and close the old
client's pools. A new client receives a new owner; pools cannot be borrowed by
a different client. Closing is idempotent, including setup/shutdown races.
The development discovery CLI retains its separately owned pool, closed when
the CLI ends.

`/internal/metrics.openDCPools` counts initialized DC pools, not sockets or
viewers. It can remain nonzero while no video is playing because connections
are intentionally kept warm, and drops when their owner closes.

Unit tests cover reuse, ownership, independent cancellation, concurrent DC
setup, retry after failed setup, runtime cancellation and shutdown during setup.
These checks do not measure live Telegram startup time or prove capacity for
1,000 viewers. Reuse removes repeated transport setup; original-file bitrate,
Telegram limits, network latency/bandwidth and server resources still determine
startup and sustained delivery speed.
