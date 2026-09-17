# Audit Remediation — Implementation Plan

**Date:** 2026-09-09  
**Scope:** Fix the high/medium-risk findings from the 2026-09-09 deep audit that are not already covered by `docs/plans/01-blockers-and-security.md` through `03-codec-drivers-hygiene.md`.

---

## Constraints

- Keep diffs minimal; do not reformat whole files.
- Every new endpoint/guard/component must have a matching test or spec.
- French for user-facing strings; English for code/identifiers.
- `pnpm test` runs the full backend Jest suite from `apps/backend`. Use `npx jest <path>` for single-file runs.
- Run `npx tsc --noEmit -p tsconfig.json` after each task to catch signature drift fast.

---

## Task 1: ~~Add login rate limiting~~ — already implemented

`auth.controller.ts` already contains an in-process sliding-window throttle on `POST /auth/login` (MAX_LOGIN_ATTEMPTS = 10 per 60s, keyed on `req.ip`). The inline throttle is correct and covered by the existing controller behaviour. No guard extraction needed.

---

## Task 2: Add a health check endpoint

**Closes:** Audit finding 4 — no throttle on login, brute-force at line rate.  
**Files:**
- Create: `apps/backend/src/auth/guards/login-throttle.guard.ts`
- Modify: `apps/backend/src/auth/auth.controller.ts`
- Modify: `apps/backend/src/auth/auth.module.ts`
- Create: `apps/backend/src/auth/__tests__/login-throttle.spec.ts`

**Interface:** `LoginThrottleGuard` — in-process sliding window, per IP, 5 attempts per 60 seconds. Independent of Redis; the install has no broker. Bound the tracked caller map to 1 000 entries so a forged-address spray cannot grow it without limit.

**Steps:**

1. Create `apps/backend/src/auth/guards/login-throttle.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const MAX_TRACKED_CALLERS = 1_000;

@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest();
    const caller = String(request.ip ?? request.socket?.remoteAddress ?? "unknown");
    const now = Date.now();

    const recent = (this.hits.get(caller) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
      this.hits.set(caller, recent);
      throw new HttpException(
        "Trop de tentatives de connexion. Patientez une minute avant de réessayer.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(caller, recent);

    if (this.hits.size > MAX_TRACKED_CALLERS) {
      for (const [key, times] of this.hits) {
        if (times.every((at) => now - at >= WINDOW_MS)) this.hits.delete(key);
      }
    }
    return true;
  }
}
```

2. Apply the guard to `POST /auth/login` in `auth.controller.ts`:

```typescript
import { LoginThrottleGuard } from "./guards/login-throttle.guard";

@UseGuards(JwtAuthGuard, LoginThrottleGuard)
@Post("login")
async login(@Body() dto: LoginDto) { ... }
```

3. Register the guard in `auth.module.ts` providers.

4. Create `apps/backend/src/auth/__tests__/login-throttle.spec.ts`:

```typescript
import { LoginThrottleGuard } from "../guards/login-throttle.guard";

const ctxFor = (ip: string) =>
  ({ getType: () => "http", switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as never;

describe("login throttle", () => {
  it("allows the first attempts and then rejects the burst", () => {
    const guard = new LoginThrottleGuard();
    for (let i = 0; i < 5; i++) expect(guard.canActivate(ctxFor("10.0.0.9"))).toBe(true);
    expect(() => guard.canActivate(ctxFor("10.0.0.9"))).toThrow();
  });

  it("tracks callers independently", () => {
    const guard = new LoginThrottleGuard();
    for (let i = 0; i < 5; i++) guard.canActivate(ctxFor("10.0.0.1"));
    expect(guard.canActivate(ctxFor("10.0.0.2"))).toBe(true);
  });
});
```

5. Run:
```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json
npx jest src/auth/__tests__/login-throttle.spec.ts
```

6. Commit:
```bash
git add apps/backend/src/auth/guards/login-throttle.guard.ts \
       apps/backend/src/auth/__tests__/login-throttle.spec.ts \
       apps/backend/src/auth/auth.controller.ts \
       apps/backend/src/auth/auth.module.ts
git commit -m "feat: throttle login attempts to 5 per minute per IP"
```

---

## Task 2: Add a health check endpoint

**Closes:** Audit finding 17 — no `/health` or `/ready` endpoint.  
**Files:**
- Modify: `apps/backend/src/app.module.ts`
- Create: `apps/backend/src/health/health.controller.ts`
- Create: `apps/backend/src/health/health.module.ts`
- Create: `apps/backend/src/health/__tests__/health.spec.ts`

**Interface:** `GET /api/health` — returns `{ status: "ok" }` with `200`. No auth. Used by the launcher and any external monitor.

**Steps:**

1. Create `apps/backend/src/health/health.controller.ts`:

```typescript
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return { status: "ok" };
  }
}
```

2. Create `apps/backend/src/health/health.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

3. Import `HealthModule` in `app.module.ts`.

4. Create `apps/backend/src/health/__tests__/health.spec.ts`:

```typescript
import { Test } from "@nestjs/testing";
import { HealthController } from "../health.controller";

describe("health", () => {
  it("returns ok", () => {
    const ctrl = new HealthController();
    expect(ctrl.health()).toEqual({ status: "ok" });
  });
});
```

5. Run:
```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json
npx jest src/health/__tests__/health.spec.ts
```

6. Commit:
```bash
git add apps/backend/src/health apps/backend/src/app.module.ts
git commit -m "feat: add unauthenticated GET /api/health endpoint"
```

---

## Task 3: Commit the uncommitted installer changes

**Closes:** Audit finding 2 — four installer scripts contain important operational fixes that are sitting uncommitted.  
**Files:**
- `installer/engine/backup-before-schema.ps1`
- `installer/engine/ensure-postgres.ps1`
- `installer/engine/launcher.ps1`
- `installer/engine/setup.ps1`

**Summary of changes already present:**
- `launcher.ps1` now tries multiple superuser passwords in order (`POSTGRES_SUPERUSER_PASSWORD` → `iq_academy_local` → `postgres` → empty) instead of a single hardcoded fallback
- Role/database creation uses temp SQL files rather than inline `-c` strings, preventing PowerShell quoting failures when passwords contain special characters
- Re-reads `DATABASE_URL` from `.env` after `ensure-postgres` auto-switches ports, so the launcher doesn't try to connect to the wrong port

**Steps:**

1. Inspect the diff to confirm the intent:
```bash
git -C "D:/School Management System" diff installer/engine/
```

2. Commit:
```bash
git -C "D:/School Management System" add installer/engine/backup-before-schema.ps1 installer/engine/ensure-postgres.ps1 installer/engine/launcher.ps1 installer/engine/setup.ps1
git -C "D:/School Management System" commit -m "fix: try multiple superuser passwords and use temp SQL files for role/database creation"
```

---

## Task 4: Surface the Google Drive limitation in the UI

**Closes:** Audit finding 3 — Google Drive OAuth only works on the machine that opened the browser, but this is only documented in `.env.example`. An administrator configuring backup on a LAN will hit a silent failure.  
**Files:**
- Modify: `apps/frontend/app/(dashboard)/settings/page.tsx` or the cloud-backup settings component
- Modify: any relevant API response if needed

**Steps:**

1. Find the cloud-backup settings component in the frontend.
2. Add a small info banner next to the Google Drive connection button:
   - Text (French): *"Google Drive : la connexion doit être ouverte depuis le serveur. Depuis un autre poste du réseau, le code d'autorisation est envoyé à la mauvaise machine et la connexion échoue silencieusement. Utilisez Dropbox pour une configuration à distance."*
3. Commit:
```bash
git add apps/frontend/app/\(dashboard\)/settings/...
git commit -m "feat: warn that Google Drive OAuth must be opened from the server machine"
```

---

## Task 5: Add Zod response validation to the API client

**Closes:** Audit finding 14 — frontend has no runtime response validation; a backend regression crashes the UI instead of surfacing a typed error.  
**Files:**
- Modify: `apps/frontend/lib/api/client.ts`
- Create: `apps/frontend/lib/api/schema.ts`

**Steps:**

1. Create `apps/frontend/lib/api/schema.ts` with Zod schemas for the most critical responses (`LoginResponse`, `AuthMe`, `StudentPayment`, `FinancialDashboard`, etc.).
2. Add a `validate` helper in `client.ts` that runs `schema.parse` on unwrapped responses.
3. Commit:
```bash
git add apps/frontend/lib/api/schema.ts apps/frontend/lib/api/client.ts
git commit -m "feat: add Zod runtime validation for critical API responses"
```

---

## Out of scope for this pass

- **`drizzle-kit push --force` migration** — requires a separate operational plan: switching launchers from `push --force` to `drizzle-kit migrate`, backfilling a baseline snapshot for existing installs, and handling the edge case where the app role cannot run `CREATE EXTENSION`. Flagged in `docs/plans/01-blockers-and-security.md` Task 6 as "needs its own plan".
- **Audit log partitioning/retention** — architectural decision needed (time-based partition vs. TTL vs. archival). Low urgency until a school reaches millions of rows.
- **Connection pooling (pgBouncer)** — deployment-level change; acceptable for LAN-only self-hosted installs today.
- **Local backup encryption** — requires a key-management decision (wrap with machine key? derive from user password?). Medium-term item.
