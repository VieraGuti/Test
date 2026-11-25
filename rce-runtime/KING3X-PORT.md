# KING3X → WIPESIDE module port

Source reviewed: supplied KING3X archive dated 2026-11-25. Only source-code patterns are reused. Do not import the original database, linked users, tokens, API credentials, shop purchases, private channel IDs or historical logs.

## Existing source mapping
| Module | Original implementation | Port requirements |
|---|---|---|
| Channels | src/commands/admin-channels.js, src/database.js (setChannel/getChannel/removeChannel) | 21 route types; preserve independent tenant/bot/server scopes. Never search another server's channels as a fallback. Runtime channel destination must belong to configured Discord guild. |
| Shop | src/commands/shop.js, src/templates/old-shop/shop_categories.json, shop_items.json, kits.json, src/managers/EconomyManager.js, src/database.js | Categories, role restrictions, paginated product selection, quantity modal, cart, purchase cooldown, linked Rust identity, virtual balance, pending purchases and partial claims. Reprice against current catalog, verify enabled product and permissions at checkout, lock balance and create order + ledger + pending delivery in one transaction. Use unique interaction ID for idempotency. |
| ZORP | src/zorp-manager.js, src/commands/zorp.js, src/rce-manager.js | Team-aware zone creation, active/protected states, delay, expiration, color/entry message, optional radiation and PvP protection, periodic validation every 30s, refresh team/player data every 5m, restart reconciliation. Validate RCON responses, use unique owned zone names, don't edit arbitrary existing zones. Persist state and verify each transition. |
| Embeds & panels | src/commands/shop.js, src/commands/admin-channels.js, src/rce-manager.js, src/utils/branding.js | Per-bot configurable titles, descriptions, colors, buttons and channel routes, safe placeholders, preview and Discord limits. Original branding helper returns defaults; real per-client customization needs storage. |
| Killfeed / stats | src/rce-manager.js, src/database.js (recordKill/recordDeath/getTopKillers/getTopKDR), src/commands/stats.js | Validate source server identity, normalize death type, deduplicate events, persist counters in tenant-scoped transactions; no fake stats. |
| Kits | src/managers/KitsManager.js, src/managers/KitManager.js, src/commands/kit-config.js, src/commands/kit-claim.js, src/gesture-manager.js | Validate kit exists, role and cooldown checks, acknowledged delivery, safe reconciliation rather than blindly retrying. |

## Implemented initial port
- Runtime channel catalog from the original 21 channel types.
- Actual Discord configuration for two currently connected routes: kills and events. Owner-only write, guild and permissions validation, lease-bound persistence per bot; active routes survive same-server restart.
- The rest are cataloged but not exposed as working routes until their modules exist.
- Current runtime remains restricted to the platform owner. Do not present this as full multi-tenant hosting or remove its guard before entitlements, capacity and isolation tests pass.

## Integration priority
1. Tenant-hosted bot control plane and web UI with per-module/channel configuration, per-bot durable state and quotas.
2. Transactional virtual economy and shop with pending delivery, role checks and Rust delivery receipts.
3. ZORP state machine with owner-managed configuration and safe rollback/reconciliation.
4. Embed and panel customization with verified channels.
5. Stats, progression and remaining modules.

Use independently created blank tenant data stores. Reuse behavior, not original production records. Test against a dedicated server and a separate Discord test guild before enabling customer hosting.
