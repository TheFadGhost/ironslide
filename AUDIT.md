# IRONSLIDE Audit Log

## Pre-release audit — 2026-08-23

Two independent auditors (code-quality + execution-based feature verification)
reviewed the codebase fresh. Neither wrote any of it.

### Critic loop (pre-audit)

| Round | Verdict | Headline issues |
| --- | --- | --- |
| 1 | FAIL | Impact pipeline unit error made feedback dead below ~127 km/h; AI backward pass missing; stacked stabilization; per-tick allocations; O(N) projections |
| 2 | FAIL | Net-plane hits polluted the impact pipeline; roadbed seams at shortcut mouths ingesting cars; dup progressList; plan decel not surface-aware |
| 3 | **PASS** | All structural items verified fixed; remaining counts judged genre-normal attrition with working recovery |

### Audit findings and dispositions

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | BLOCKER | `audio.init()` never called — game shipped silent | Fixed: called on START click gesture; volume applied at same point |
| 2 | MAJOR | Menu settings write-only (volume/postfx/shadows did nothing) | Fixed: live-applied each frame via diffed `applySettings()` incl. shadow material refresh |
| 3-8 | MAJOR | Dead/duplicated config (`AI.longAccel`, `AI.count`, `PERF`, `AUDIO.tireNoiseFloor`, rubber-band constants hardcoded in race.ts, flip timeout literal) | Fixed: dead entries deleted; race.ts now imports `AI.rubberBandRange/Max` and `VEHICLE.resetIfFlippedFor` from config |
| 9 | MAJOR | Environment handle discarded (clouds frozen, dispose unreachable) | Fixed: handle stored, `env.update(player)` called per frame |
| 10 | MAJOR | `"sim"` npm script pointed at nonexistent file | Fixed: `scripts/sim.ts` implemented (JSON telemetry summary); README matches |
| 11-28 | MINOR | Dead flags, duplicated polyline-distance/clamp helpers, lying wheel-id cast, triple `sampleAt` in hot loop, unbounded spin accumulator, DNF label for mid-race cars, scratch scripts | Partially fixed: racing-vs-DNF labels, spin wrap, scratch pruning, sim entry. Accepted as-is: shared math-helper extraction (cosmetic), skid wheelId param, remaining `void` suppressions — noted for a future tidy pass |
| QA-3 | MAJOR (design) | Damage saturates to 1.0 for whole field; no repair | Accepted for v1.0 with honest README caveat; repair/lap-partial-repair is the top v1.1 candidate |
| QA-2/QA-caveat | MINOR | Off-road past shoulder = void drop + instant respawn; falls cluster near chicane exit | Accepted: walls make this deliberate runoff behavior; recovery is instant and lap validity is preserved. Chicane-exit hotspot flagged for first post-release tuning pass |

### Feature verification (execution-based)

All nine requested features verified by running code: suspension travel
(0.04–0.34 m observed), weight transfer (braking pitch mean −2.2°), non-launching
collisions, 13.47 m elevation range, radii 8.5 m–5.9 km, hazards used by AI,
±7.5% rubber-band measured exactly, headway avoidance probe clean, impulse-scaled
shake/deform/audio, fading skids with correct alpha math, five-surface grip
differentiation, lap/checkpoint gating incl. backwards-crossing rejection,
camera FOV 60→74.7° + hood/orbit modes, full headless races complete NaN-free.

### Final state at v1.0.0

- `npx tsc --noEmit` strict: clean
- `vitest`: 21/21 passing
- Full headless race: completes, no NaN, lap times ~93–110 s, impacts real
- Physics step cost: ≈0.6–0.9 ms full field (120 Hz) — render owns the frame budget
- Known accepted limitations: damage never repairs; one AI fall hotspot at the
  chicane exit (auto-recovers); gamepad path untested by automation (code-reviewed only)
