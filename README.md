# GCW Server

Production-ready, horizontally-scalable Node.js backend for a TikTok-style live-gifting + creator payout platform targeting African mobile-money markets (M-Pesa, EVC Plus, e-Dahab) plus global cards via Stripe.

## Architecture

```
                                   ┌─────────────────┐
                                   │   Frontend      │
                                   │ (Vite/React)    │
                                   └───────┬─────────┘
                                           │ REST + Socket.io
                                           ▼
                       ┌───────────────────────────────────────┐
                       │           API node(s) :4000            │
                       │  Express 4 + Socket.io 4 (ESM)         │
                       │  helmet, cors, rate-limit, pino        │
                       │  JWT auth · idempotency · zod          │
                       └───────┬───────────────────┬───────────┘
                               │                   │
                    ┌──────────▼─────────┐  ┌──────▼───────────┐
                    │   PostgreSQL 15     │  │     Redis 7       │
                    │  drizzle-orm        │  │ rate-limit store   │
                    │  double-entry       │  │ Socket.io adapter   │
                    │  wallet/creator     │  │ idempotency cache   │
                    │  ledgers            │  │ leaderboards (ZSET) │
                    └──────────▲──────────┘  └──────▲─────────────┘
                               │                    │
                       ┌───────┴────────────────────┴───────┐
                       │         BullMQ worker process        │
                       │  payout · webhook-retry · email      │
                       │  reconcile · promote-pending          │
                       │  fx-snapshot                          │
                       └───────┬───────────────────────────────┘
                               │
              ┌────────────────┼─────────────────────┐
              ▼                ▼                      ▼
        ┌──────────┐   ┌──────────────┐       ┌───────────────┐
        │  Stripe  │   │ M-Pesa Daraja │       │ EVC Plus /     │
        │  (cards) │   │ (stub adapter)│       │ e-Dahab (stub) │
        └──────────┘   └──────────────┘       └───────────────┘
```

Multiple API nodes can run behind a load balancer; Socket.io state is shared via `@socket.io/redis-adapter` so a gift sent to a stream reaches viewers connected to any node. The worker process scales independently and can run N replicas (BullMQ handles distributed locking per job).

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up
```

This boots `postgres`, `redis`, `api` (runs migrate → seed → start), and `worker`. API is on `http://localhost:4000`, docs at `http://localhost:4000/docs`.

## Quick start (no Docker)

```bash
cp .env.example .env
# point DATABASE_URL / REDIS_URL at your local Postgres 15 / Redis 7
npm install
npm run migrate
npm run seed
npm run dev        # API on :4000
npm run worker:dev # in a second terminal
```

## Point the existing frontend at this backend

```
VITE_API_URL=http://localhost:4000
```

Socket.io client should connect to the same origin and authenticate via:

```js
io(import.meta.env.VITE_API_URL, { auth: { token: accessToken, walletToken } });
```

## Seed data

- Admin: `admin@gcw.app` / `Admin!234`
- Creator: `habaryare_live` / `Password!234` — 412,000 lifetime coins (level 2), KYC approved, 2FA disabled. `GET /api/public/creators/habaryare_live` works immediately.
- QA tier fixtures: `qa_level1` .. `qa_level4` / `Password!234` (one per `CREATOR_TIERS` threshold, KYC approved).
- A viewer wallet is seeded with 50,000 coins (its `wallet_token` is printed by `npm run seed`).
- Full gift catalog matching the frontend's `GIFTS` array: `vibe_shades, aero_flare, hir, glow_drop, holo_disc, kalluun, dhaanto, dufaan, star, gashaan, libaax, guul`.

## Swapping stub gateways for real credentials

Each gateway lives in `src/gateways/*.ts` behind the same `PaymentGateway` interface (`charge`, `payout`, `verifyWebhookSignature`, `extractExternalId`). With no credentials set, each gateway auto-stubs (`mpesa_stub_...`, `evc_stub_...`, etc.) so the full flow works end-to-end in dev without real money movement.

- **Stripe**: set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. Uses real `paymentIntents` / `transfers` once set.
- **M-Pesa (Daraja)**: set `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL`. Replace the `TODO(real integration)` blocks in `src/gateways/mpesa.ts` with OAuth + STK Push (`charge`) / B2C (`payout`) calls per Safaricom's Daraja docs.
- **EVC Plus**: set `EVC_MERCHANT_ID`, `EVC_API_KEY`, `EVC_WEBHOOK_SECRET`. Fill in `src/gateways/evcplus.ts` per Somtel's merchant API docs.
- **e-Dahab**: set `EDAHAB_API_KEY`, `EDAHAB_MERCHANT_ID`, `EDAHAB_WEBHOOK_SECRET`. Fill in `src/gateways/edahab.ts` per eDahab's API docs.

All four webhook endpoints (`/api/public/webhooks/*`) already do signature verification (`crypto.timingSafeEqual`), dedupe via `webhook_events.external_id`, and enqueue a BullMQ job — no route changes needed when you swap in real gateway credentials.

## Endpoints (curl examples)

Base URL: `http://localhost:4000`

### Auth

```bash
# Signup
curl -X POST localhost:4000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"fan@example.com","password":"Sup3rSecret!","username":"fan1"}'

# Login
curl -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"habaryare_live@gcw.app","password":"Password!234"}'

# Refresh
curl -X POST localhost:4000/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'

# Logout
curl -X POST localhost:4000/api/auth/logout \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'

# Me
curl localhost:4000/api/auth/me -H 'Authorization: Bearer <accessToken>'

curl -X POST localhost:4000/api/auth/verify-email -H 'Content-Type: application/json' -d '{"token":"<token>"}'
curl -X POST localhost:4000/api/auth/forgot -H 'Content-Type: application/json' -d '{"email":"fan@example.com"}'
curl -X POST localhost:4000/api/auth/reset -H 'Content-Type: application/json' -d '{"token":"<token>","password":"NewPass!234"}'

curl -X POST localhost:4000/api/auth/2fa/setup -H 'Authorization: Bearer <accessToken>'
curl -X POST localhost:4000/api/auth/2fa/enable -H 'Authorization: Bearer <accessToken>' -H 'Content-Type: application/json' -d '{"code":"123456"}'
curl -X POST localhost:4000/api/auth/2fa/disable -H 'Authorization: Bearer <accessToken>' -H 'Content-Type: application/json' -d '{"code":"123456"}'
```

### Creator

```bash
curl localhost:4000/api/creators/profile -H 'Authorization: Bearer <accessToken>'

curl -X PATCH localhost:4000/api/creators/profile \
  -H 'Authorization: Bearer <accessToken>' -H 'Content-Type: application/json' \
  -d '{"displayName":"New Name"}'

curl -X POST localhost:4000/api/creators/cashout \
  -H 'Authorization: Bearer <accessToken>' -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 3f2f9c3e-...-uuid' \
  -d '{"destinationType":"mpesa","destinationAccount":"254700000000","amountCents":2000,"totp":"123456"}'

curl "localhost:4000/api/creators/cashouts?cursor=" -H 'Authorization: Bearer <accessToken>'

curl -X POST localhost:4000/api/creators/kyc \
  -H 'Authorization: Bearer <accessToken>' -H 'Content-Type: application/json' \
  -d '{"fullName":"Jane Doe","dob":"1995-01-01","idType":"passport","idNumber":"A1234567","country":"KE"}'

curl localhost:4000/api/creators/kyc -H 'Authorization: Bearer <accessToken>'
```

### Wallet / Payments

```bash
curl -X POST localhost:4000/api/payments/buy-coins \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: 8a1b...-uuid' \
  -d '{"method":"stripe","amountCents":500,"coins":500}'

curl localhost:4000/api/payments/wallet-balance/<walletToken>

curl -X POST localhost:4000/api/payments/wallet/link \
  -H 'Authorization: Bearer <accessToken>' -H 'Content-Type: application/json' \
  -d '{"walletToken":"<walletToken>"}'
```

### Gifts

```bash
curl localhost:4000/api/gifts/catalog

curl -X POST localhost:4000/api/gifts/send \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: 9c2d...-uuid' \
  -d '{"streamId":"<streamId>","creatorId":"<creatorId>","senderWalletToken":"<walletToken>","senderName":"AhmedFan47","giftId":"star"}'
```

### Streams

```bash
curl -X POST localhost:4000/api/streams -H 'Authorization: Bearer <accessToken>' -H 'Content-Type: application/json' -d '{"title":"Going live!"}'
curl -X PATCH localhost:4000/api/streams/<id>/end -H 'Authorization: Bearer <accessToken>'
curl localhost:4000/api/streams/live
curl localhost:4000/api/streams/<id>
```

### Challenges

```bash
curl -X POST localhost:4000/api/challenges/start -H 'Authorization: Bearer <accessToken>' -H 'Content-Type: application/json' -d '{"streamId":"<id>","type":"gift-battle"}'
curl -X POST localhost:4000/api/challenges/<id>/end -H 'Authorization: Bearer <accessToken>'
curl "localhost:4000/api/challenges/active?streamId=<id>"
```

### Leaderboard

```bash
curl "localhost:4000/api/leaderboard/top-senders?streamId=<id>&period=live"
curl "localhost:4000/api/leaderboard/top-creators?period=day"
```

### Follows / Notifications / Moderation

```bash
curl -X POST localhost:4000/api/follows/<creatorId> -H 'Authorization: Bearer <accessToken>'
curl -X DELETE localhost:4000/api/follows/<creatorId> -H 'Authorization: Bearer <accessToken>'
curl localhost:4000/api/notifications -H 'Authorization: Bearer <accessToken>'
curl -X POST localhost:4000/api/notifications/<id>/read -H 'Authorization: Bearer <accessToken>'
curl -X POST localhost:4000/api/reports -H 'Authorization: Bearer <accessToken>' -H 'Content-Type: application/json' -d '{"targetType":"user","targetId":"<id>","reason":"spam"}'
curl -X POST localhost:4000/api/blocks/<userId> -H 'Authorization: Bearer <accessToken>'
```

### Public (no auth)

```bash
curl localhost:4000/api/public/creators/habaryare_live
curl localhost:4000/api/public/streams/live
curl localhost:4000/api/public/leaderboard/top-creators
```

### Webhooks

```bash
curl -X POST localhost:4000/api/public/webhooks/stripe -H 'stripe-signature: <sig>' -d '<raw body>'
curl -X POST localhost:4000/api/public/webhooks/mpesa -H 'x-mpesa-signature: <sig>' -d '<raw body>'
curl -X POST localhost:4000/api/public/webhooks/evcplus -H 'x-evc-signature: <sig>' -d '<raw body>'
curl -X POST localhost:4000/api/public/webhooks/edahab -H 'x-edahab-signature: <sig>' -d '<raw body>'
```

### Ops

```bash
curl localhost:4000/healthz
curl localhost:4000/readyz
curl localhost:4000/metrics
open http://localhost:4000/docs
```

## Socket.io

Connect with `{ auth: { token, walletToken } }`. Creators auto-join `creator:<userId>`; clients call `socket.emit("subscribe:stream", streamId)` to join `stream:<id>`.

Events emitted: `NEW_GIFT_EVENT`, `VIEWER_COUNT`, `CHALLENGE_UPDATE`, `STREAM_ENDED`, `CASHOUT_STATUS`. `NEW_GIFT_EVENT`'s payload shape is fixed and must not change:

```json
{ "id":"uuid","giftName":"Star","senderName":"AhmedFan47","coins":15000,"grossUsd":150,"platformFeeUsd":27,"creatorShareUsd":123,"feePercentage":18,"time":1720000000000 }
```

## Money & ledger invariants

- All money is integer cents (`bigint` columns). Never floats.
- Every balance mutation (wallet coin balance, creator pending/payout balance) happens in the same DB transaction as its ledger row insert — see `src/ledger/wallet.ts` and `src/ledger/creator.ts`.
- Creator earnings land in `pending_balance_cents` with `available_at = now() + CASHOUT_HOLD_DAYS`; the hourly `promote-pending` job moves matured rows into `payout_balance_cents`.
- The nightly `reconcile` job asserts `SUM(ledger.delta) == balance` per wallet/creator and pages Sentry on drift.
- Gift tier: `calculateLevelFromCoins` is evaluated against `lifetime_coins + gift.coins` **inside the same transaction** as the gift event insert, so a gift that crosses a milestone (e.g. 349,900 → 350,100 coins) immediately earns the new tier's cut on that same gift.

## Security

- Idempotency-Key required (and cached 24h in Redis) on all money-moving POSTs: buy-coins, gifts/send, cashout.
- Webhook signatures verified over the raw body with `crypto.timingSafeEqual`; deduped via `webhook_events.external_id`.
- Refresh tokens are rotated on every `/refresh` call and stored hashed; reusing an already-rotated token revokes the entire token family (theft detection).
- 2FA (TOTP) required before cashout and before disabling 2FA. KYC must be `approved` before the first cashout.
- Rate limits (Redis-backed): auth 5/min/IP, gift-send 30/min/user, cashout 5/hour/user, global 300/min/IP.
- Zod `.strict()` schemas reject unknown keys on every body.
- PII (email, phone, password, TOTP secret, card/account numbers) is redacted from pino logs.

## Testing

```bash
npm test
```

Requires a running Postgres + Redis (`docker compose up postgres redis` then `npm run migrate`). Covers: tier math and mid-gift tier crossing, cents/fee-split invariants, signup→login→refresh (+ refresh-token reuse detection), buy-coins idempotency (same key twice ⇒ one topup), gift-send transaction atomicity (insufficient balance leaves balances untouched; successful send debits/credits/updates tier atomically), cashout gating (2FA → KYC → minimum amount), and webhook signature rejection.

## Notes on this environment

This repo was authored and statically reviewed in a sandboxed environment without outbound access to the npm registry, so `npm install` / `tsc` / `vitest run` could not be executed here to produce a green CI run. All imports were manually verified to resolve, and every schema field, route, socket event, and job was cross-checked against this spec. Run `npm install && npm run typecheck && npm test` locally (or via `docker compose up`) as your first step after cloning.
