# Nudge · Frontend

Single-page app built with React 19, Vite and TypeScript. UI is [shadcn/ui](https://ui.shadcn.com) (Radix + Tailwind CSS v4), routing is React Router and server state is TanStack Query. It consumes the Nudge API; the project overview and deployment notes live in the [root README](../../README.md). The interface and route names are in Spanish.

## Scripts

Run them from `apps/app` with Bun.

| Command | What it does |
|---|---|
| `bun run dev` | Dev server at http://localhost:5173 |
| `bun run build` | Type-check (`tsc -b`) and build to `dist/` |
| `bun run preview` | Serve the production build locally |
| `bun run lint` | Oxlint |

## Running locally

By default the app uses the deployed API through the Vite proxy: the browser calls `/api/...` and Vite forwards it to the real API (`vite.config.ts`), rewriting the cookie path. This keeps the `refresh_token` cookie (`SameSite=Lax`, `Path=/auth`) same-site in development, so the session survives a page reload.

To use your local API, create `.env.local` with:

```
API_PROXY_TARGET=http://localhost:3000
```

## Configuration

| Variable | Used when | Description |
|---|---|---|
| `VITE_API_URL` | Production build | Public URL of the API, e.g. `https://nudge-api.estebanlt.com`. See `.env.template`. Vite inlines it at build time, so changing it requires a new build |
| `API_PROXY_TARGET` | Dev server only | API the dev proxy forwards `/api` to |

When `VITE_API_URL` is not set, the client falls back to `/api` (the dev proxy).

In production the frontend must be on the same site as the API (for example `nudge.estebanlt.com` and `nudge-api.estebanlt.com`), or the API must use `REFRESH_COOKIE_SAME_SITE=none`. The API must also list the frontend origin in `CORS_ORIGIN`.

## How it works

### API client and session

`src/lib/api/client.ts` wraps `fetch` and always sends credentials:

- The **access token lives only in memory**. The refresh token is an HttpOnly cookie the browser sends to `/auth/*`, so no token is ever written to `localStorage`.
- On a `401` the client renews the session once (`/auth/refresh`) and repeats the request. Concurrent callers share a single refresh request. If it fails it retries after about a second, because another tab may have just rotated the cookie.
- If the session cannot be renewed, a handler opens the "session expired" dialog.
- Every non-2xx response becomes an `ApiError` with the status and the API's message list, and network failures become status `0`. `lib/errors.ts` maps them to user-facing messages.

`endpoints.ts` holds one typed function per API endpoint and `types.ts` the response types.

### Data fetching

Each feature keeps its TanStack Query hooks in `queries.ts` (catalog, trackings, alerts), which handle caching and invalidation, for example refreshing the trackings list after following or unfollowing a product.

### Routing and auth

Routes are defined in `src/router.tsx` with three groups: account screens on a minimal layout, public pages (home, categories, best sellers, search) and pages that need a session (trackings, tracking detail, alerts, account, change password, Mercado Libre connection for admins). `RequireAuth` and `RequireGuest` guard them. `/reset-password` and `/unsubscribe` are fixed paths because the API's emails link to them.

If a visitor presses "Seguir precio" without a session, the product is kept in `sessionStorage` through login or registration and the follow dialog opens afterwards.

### Price history

The tracking detail page draws the price history chart (`features/tracking/price-history-chart.tsx`) from `GET /products/:id/price-history`, and lets the user edit the threshold (a target price or a percentage drop), pause, resume or unfollow.

## Structure

```
src/
├── components/ui/      # shadcn/ui components, adjusted to the design's colors and sizes
├── components/common/  # logo, price, states, form field and other shared pieces
├── components/layout/  # header, footer, search form, splash screen, layouts
├── features/           # logic by domain: account, alerts, auth, catalog, tracking
├── lib/api/            # HTTP client with session renewal, endpoints and API types
├── lib/format.ts       # prices, percentages, relative dates
├── lib/errors.ts       # error messages
├── pages/              # one component per screen
├── router.tsx          # routes
└── index.css           # theme variables (light and dark) and Tailwind setup
```

Design colors are CSS variables in `src/index.css`, with a light and a dark theme (the dark one follows the system preference, see `main.tsx`). The favicon is `public/favicon.svg`, the same mark as the `LogoMark` component.

## Adding shadcn components

```bash
bunx --bun shadcn@latest add <component>
```

Check that the generated imports use `@/lib/utils`: the CLI sometimes writes `"cn"` instead.

## Deployment

The build is static (`dist/`), so no Docker is needed. It is deployed as a Render Static Site with root directory `apps/app`, build command `bun install --frozen-lockfile && bun run build`, publish directory `dist` and a rewrite `/*` → `/index.html` so reloads on deep links work.
