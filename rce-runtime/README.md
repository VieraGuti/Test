# Event Cloud Render runtime (evaluation)
Owner-only, one worker subprocess. No Docker socket. Docker is used only to build the service image.
Deploy with Docker context rce-runtime and Dockerfile rce-runtime/Dockerfile.
Required private environment variables: DATABASE_URL (dedicated persistent PostgreSQL), SUPERVISOR_KEY (shared with Vercel), RUNTIME_SECRETS_KEY (random 32-byte base64 AES key), OWNER_TENANT_ID (workspace UUID), CONTROL_PLANE_URL (Vercel HTTPS origin).
Vercel requires SUPERVISOR_URL and the matching SUPERVISOR_KEY. Never commit credentials.
Health: GET /healthz verifies PostgreSQL. Live verification requires signed control requests and actual Discord and RCON credentials.
Render Free may sleep and lose network connectivity; this is not production-grade multi-tenant isolation or a 24/7 SLA. Do not sell subscriptions on this evaluation backend. A free Render database expires; migrate to durable Postgres before actual events.
Build runs smoke tests, including engine simulation, encryption, signed requests and coordinate parsing. Real RCON and Discord tests remain separate.