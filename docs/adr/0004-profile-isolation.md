# ADR-0004: Profile Isolation Architecture (REQ-011)

**Status**: Accepted
**Date**: 2025-10-05
**Context**: 04 文档 REQ-011「账号隔离改为架构保证」

## Problem

Multiple users share the same database. Without architectural enforcement, a business-layer bug (forgetting `WHERE profile_id = ?`) can leak one user's data to another.

## Decision

Three-layer defense:

### Layer 1: JWT Token

JWT payload contains `{sub, profileId, role}`. `ProfileId` must match a `user_profile` record owned by `sub`.

### Layer 2: ProfileGuard

- Validates ownership: `user_profile.user_id === jwt.sub`
- Injects `request.scope` (readonly, unforgeable): `{userId, profileId, role}`
- Rejects with 403 `PROFILE_FORBIDDEN` (1107) on mismatch

### Layer 3: profileWhere()

- `profileWhere(scope, column, ...extra)` returns `and(eq(column, scope.profileId), ...extra)`
- ALL user data queries MUST use this function
- `depcruise` rule `profile-scope-chokepoint` forbids direct `drizzle-orm` imports in modules
- All query operators come from `infra/db/query.ts` (single chokepoint)

## Schema Deviation

`user_profile` uses `user_id` as PRIMARY KEY (1:1 with `user`). There is NO independent `profile_id` column. The `profileId` in JWT numerically equals `userId`. Future multi-profile-per-account support requires schema change.

## userId vs profileId

From `profile-scope.ts` header:
- `userId` = account identity (who is logged in)
- `profileId` = data ownership (whose data)
- Currently equal (1:1), but semantically distinct for future multi-profile support

## Known Limitations

1. **Cross-profile testing**: `profile-isolation.spec.ts` validates with real HTTP requests and forged JWTs
2. **SQLite boolean handling**: boolean columns need `as unknown as boolean` pattern (documented in ADR-0004 §2)
3. **Schema deviation**: no independent `profile_id` column (documented above)
4. **depcruise**: rule `profile-scope-chokepoint` enforces query operator chokepoint

## Alternatives Considered

1. **Per-query manual filtering**: Too error-prone, requires developer discipline
2. **PostgreSQL RLS**: Only works for PG, not SQLite; complex to set up
3. **ORM middleware**: Too complex, brittle with different query patterns
4. **Separate database per user**: Too expensive at scale

## Consequences

- Positive: Profile isolation is architecturally enforced, not reliant on business-layer discipline
- Positive: Cross-profile access is caught at the guard level (403), not silently returning wrong data
- Negative: Every query touching user data must go through `profileWhere()` — no shortcuts
- Negative: Schema deviation (user_id = profile_id) must be documented and tracked for future schema changes

## Commit Reference

The profile isolation architecture is implemented in:
- `infra/profile/profile-scope.ts` — core primitives (ProfileScope, profileWhere, assertOwned)
- `infra/profile/profile.guard.ts` — ownership validation + scope injection
- `infra/db/query.ts` — query operator chokepoint
- `.dependency-cruiser.js` — rule: `profile-scope-chokepoint`
- `test/profile-isolation.spec.ts` — cross-profile validation tests
