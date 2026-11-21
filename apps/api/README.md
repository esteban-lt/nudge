# Nudge · API

REST API built with [NestJS](https://nestjs.com/) (TypeScript, ESM) and TypeORM on PostgreSQL. It reads product data from the official Mercado Libre API, stores price history, evaluates price-drop alerts and sends emails. The project overview, setup steps, environment variables and the endpoint list live in the [root README](../../README.md); this file explains how the API is organized and how it works.

## Scripts

Run them from `apps/api` with Bun.

| Command | What it does |
|---|---|
| `bun run start:dev` | Start in watch mode (http://localhost:3000) |
| `bun run build` | Compile the app and the migrations (`dist/`) |
| `bun run start:prod` | Run the compiled app |
| `bun run lint` | Oxlint over `src/` and `test/` |
| `bun run test` · `bun run test:e2e` | Unit tests / integration tests against `TEST_DATABASE_URL` |
| `bun run migration:generate migrations/Name` | Generate a migration from the entity changes |
| `bun run migration:run` · `migration:revert` · `migration:show` | Apply / revert / list migrations |

Configuration is read from `.env` (copy `.env.template`, which documents every variable) and validated with Joi at startup (`src/config/env.ts`): the app refuses to boot if a required production variable is missing.

## Architecture

One Nest module per domain, each with its controller, service, DTOs and entities:

```
src/
├── auth/              # register, login, email verification, sessions, password reset
├── users/             # profile settings, email-notification opt-out and unsubscribe tokens
├── mercado-libre/     # OAuth, HTTP client with retries and circuit breaker, catalog endpoints
├── products/          # product entity + provider registry (Mercado Libre; Amazon is a stub)
├── price-history/     # price snapshots per product
├── tracked-products/  # a user following a product with a threshold
├── price-refresh/     # scheduled job that refreshes prices
├── alerts/            # alert detection, inbox and email dispatch
├── mail/              # Resend client and email helpers
├── health/            # GET /health
└── config/            # env validation, TypeORM data source, rate limits
```

Global setup (`src/app.setup.ts`) is shared by `main.ts` and the e2e tests, so tests exercise the app as it really runs: Helmet, CORS with credentials for the origins in `CORS_ORIGIN`, `cookie-parser`, and a global `ValidationPipe` (`whitelist` and `forbidNonWhitelisted`, so unknown fields are rejected). `trust proxy` is on because Render sits in front, which keeps per-client rate limiting correct. Rate limiting uses `@nestjs/throttler`: 100 requests per minute by default and 5 per minute on sensitive auth endpoints.

## How it works

### Authentication and sessions

- Passwords are hashed with bcrypt. Registration sends a 6-digit code by email; the account cannot get a session until it is verified. Between registration and verification the client holds a short-lived `verificationToken` that only works on the two verification endpoints.
- Login returns a 15-minute JWT access token in the body (signed with issuer and audience claims, validated by Passport) and sets a **refresh token as an HttpOnly cookie** scoped to `/auth`. Only a SHA-256 hash of the refresh token is stored, in the `sessions` table.
- Refreshing **rotates** the token. Reusing an already revoked token revokes the whole token family of that user's session. The JWT carries the user id and the session id, and the guard checks the session on every request, so logout or revocation takes effect immediately instead of waiting for the token to expire.
- `REFRESH_COOKIE_SAME_SITE` defaults to `lax`, which requires the frontend and the API to share the same site (for example `nudge.example.com` and `nudge-api.example.com`).

### Mercado Libre integration

The account is linked once through OAuth 2.0 (Authorization Code, admins only) and the access token is renewed automatically afterwards. The HTTP layer adds, per request: a timeout, up to two retries for reads on network errors, `5xx` and `429` (exponential backoff with jitter, honoring `Retry-After`), and a circuit breaker that stops calling Mercado Libre for 30 seconds after 5 consecutive failures (the API answers `503`). Catalog results are filtered to products that have active sellers, and the lowest price across sellers is what gets stored.

`products/providers` defines a provider interface and a registry, so another store can be added without touching the tracking or alert logic.

### Price refresh

`PriceRefreshScheduler` registers a `cron` job when the app starts (`PRICE_REFRESH_CRON`, `PRICE_REFRESH_TIMEZONE`). Each run:

1. Loads the tracked products that need a refresh (those with a recent snapshot are skipped).
2. Fetches their current price with bounded concurrency and stores a row in `price_history`.
3. Runs alert detection for each new snapshot.
4. Dispatches pending alert emails.

A run is skipped if the previous one is still in progress. The job lives **inside the Node process**, so it only fires while the API is awake: host it on an always-on instance. A product that Mercado Libre reports as unavailable, or a failure on a single product, never stops the rest of the run.

### Alerts

A tracking has a threshold of type `price_below` (absolute price) or `percentage_drop`. `AlertDetectionService` creates one alert when a new snapshot crosses the threshold of an active tracking. Alerts appear in the in-app inbox, and `AlertDispatchService` emails them right after each refresh, with a single retry 10 minutes later for any still pending. Emails include a one-click unsubscribe (`List-Unsubscribe` and `List-Unsubscribe-Post`, RFC 8058) backed by a signed token, so no session is needed.

### Email

`MailService` wraps [Resend](https://resend.com/). In development without `RESEND_API_KEY` it logs the recipient, subject and plain text instead of sending. The links in emails are built from `FRONTEND_URL` (reset password, unsubscribe) and `API_URL` (unsubscribe header).

## Database and migrations

The schema is managed only by migrations in `migrations/`; `synchronize` is off everywhere. The Docker image runs `migration:run` right before starting the API, so deploying a new version updates the schema.

## Tests

Tests mirror `src` under `test/`. Unit tests (`*.spec.ts`) need no database. Integration tests (`*.e2e-spec.ts`) apply the migrations to `TEST_DATABASE_URL` and wipe it before each test, and refuse to run against `DATABASE_URL`. Mercado Libre and Resend are always replaced by test doubles, so no credentials or real emails are involved. `test/no-secrets.e2e-spec.ts` checks that responses do not leak sensitive fields.

## Docker

`Dockerfile` is a multi-stage build: dependencies and compilation with Bun on a Node 22 Alpine base, a separate production-only `node_modules` stage, and a final image that runs as the unprivileged `node` user with a `/health` healthcheck. It contains no `.env` or secrets. See the root README for run commands and the environment variables to pass.
