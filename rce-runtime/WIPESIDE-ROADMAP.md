# WIPESIDE — Rust Console server operating platform

Scope: a dedicated Discord bot per customer, one or more authorized Rust Console servers per subscription; isolated data, configuration, credentials and quotas. Events are one module, not the entire product.

## Foundation (release gate before selling managed hosting)
- Tenant-bound bot supervisor with per-bot lease, resource budget and server ownership checks; no cross-tenant commands or channels.
- Entitlement checks on every runtime action, verified Discord identity and a seven-day trial, automatic suspension with safe recovery; events/config remain exportable.
- Encrypted secrets, explicit bot permissions, staff roles, rate limits, audit history, error and health reporting, documented recovery.
- Free editor and templates remain available without a hosted bot.

## Module roadmap
Status: existing means code is present, not a claim of completed live verification. Planned features must not expose a working toggle until the handler, persistence, authorization and tests are implemented.
| Suite | Existing / first milestone | Planned features |
|---|---|---|
| Core | Account linking, bot connection, module controls, event execution and simulation | Dedicated per-customer workers, multi-server setup, dashboard/staff tags, bot profile, audit log, live playercount, health, website API, player portal |
| Feeds & stats | Killfeed from RCON playerKill, basic event position tracking | Channel routing, join/leave, playtime, player history, leaderboards, activity heat map, scheduled wipe history, streaming announcements |
| Economy | No persistent economy yet | Virtual coins ledger, shop, player bag, rewards, achievements, XP, battle pass, virtual stocks, clans and teams, quarrys, bounty, kits, boosters, double XP |
| Rust automation | Event studio, safe positions/return, kit and spawn commands | Emote kits, teleport/home, auto-spawn/auto-kit, timed events, event schedule, random items, nuclear fallout, oil event, catch-a-ride, time change, wipe schedule/script, recycler, item ban, prison, offline raid alerts, offline protection, queue passes, new-player protection, map generator |
| Discord tools | Bot commands and event announcements | Embed/menu builder, timed/repeating announcements, giveaways/polls, support tickets, report/suggestions, auto-mod, welcome/leave, AFK, purge/auto-clean, role colors/name effects, colour studio |
| Virtual games | No casino implemented | Virtual-currency-only casino and crate games, robbery, lucky wheels, counting, advent calendar, locked crate, Rusty Crate; no cash-out or wagered real money |
| Administration | RCON integration and restricted event command handlers | Permissioned single/batch console, command scheduler, confirmation on destructive changes, player dossiers, kit builder, server management |
| Commerce | Stripe plans exist; paid hosting not verified end-to-end | Separate real-money store for eligible permitted goods only, payment compliance and idempotent fulfillment; no real-money gambling |

## Definition of done for a module
Actual documented Rust Console/Discord capability; strict server/tenant authorization; verified input; durable state if required; configurable UI; runtime health and error feedback; automated tests; separate real server test; explicit limitations. Features not supported by official RCON must not be simulated as real.
