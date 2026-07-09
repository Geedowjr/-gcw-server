// Minimal OpenAPI 3.1 spec builder. Kept hand-written (not auto-derived from
// zod schemas) so every documented shape is guaranteed to match what the
// frontend actually receives — see README for the full endpoint list.

const bearerAuth = { type: "http", scheme: "bearer", bearerFormat: "JWT" } as const;

export function buildOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "GCW — Live Gifting & Creator Payouts API",
      version: "1.0.0",
      description:
        "TikTok-style live-gifting + creator payout platform for African mobile-money markets (M-Pesa, EVC Plus, e-Dahab) plus global cards.",
    },
    servers: [{ url: "http://localhost:4000", description: "Local" }],
    components: {
      securitySchemes: { bearerAuth },
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            username: { type: "string" },
            displayName: { type: "string", nullable: true },
            avatarUrl: { type: "string", nullable: true },
            role: { type: "string", enum: ["user", "creator", "admin"] },
            emailVerified: { type: "boolean" },
            twoFAEnabled: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        AuthTokens: {
          type: "object",
          properties: {
            accessToken: { type: "string" },
            refreshToken: { type: "string" },
            user: { $ref: "#/components/schemas/User" },
          },
        },
        CreatorProfile: {
          type: "object",
          properties: {
            userId: { type: "string", format: "uuid" },
            username: { type: "string" },
            lifetimeCoins: { type: "integer" },
            lifetimeEarningsUsd: { type: "number" },
            payoutBalanceUsd: { type: "number" },
            pendingBalanceUsd: { type: "number" },
            currentLevel: { type: "integer" },
            tierKey: { type: "string", enum: ["level1", "level2", "level3", "level4"] },
            cutPct: { type: "number" },
            nextMilestone: { type: "integer", nullable: true },
            kycStatus: { type: "string", enum: ["none", "pending", "approved", "rejected"] },
            twoFAEnabled: { type: "boolean" },
          },
        },
        Gift: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            emoji: { type: "string" },
            imageUrl: { type: "string", nullable: true },
            coins: { type: "integer" },
            usdCents: { type: "integer" },
            premium: { type: "boolean" },
            active: { type: "boolean" },
          },
        },
        NewGiftEvent: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            giftName: { type: "string" },
            senderName: { type: "string" },
            coins: { type: "integer" },
            grossUsd: { type: "number" },
            platformFeeUsd: { type: "number" },
            creatorShareUsd: { type: "number" },
            feePercentage: { type: "number" },
            time: { type: "integer", description: "epoch millis" },
          },
        },
        Cashout: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            destinationType: { type: "string", enum: ["mpesa", "evcplus", "edahab", "stripe", "bank"] },
            destinationAccount: { type: "string" },
            amountCents: { type: "integer" },
            currency: { type: "string" },
            status: { type: "string", enum: ["pending", "processing", "paid", "failed"] },
            requestedAt: { type: "string", format: "date-time" },
            paidAt: { type: "string", format: "date-time", nullable: true },
          },
        },
        Error: {
          type: "object",
          properties: { error: { type: "string" }, details: { type: "object", nullable: true } },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/auth/signup": {
        post: {
          tags: ["auth"],
          summary: "Create a new account",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password", "username"],
                  properties: {
                    email: { type: "string" },
                    password: { type: "string" },
                    username: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthTokens" } } } },
            "409": { description: "Email taken", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/auth/login": {
        post: {
          tags: ["auth"],
          summary: "Log in",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: { email: { type: "string" }, password: { type: "string" }, totp: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthTokens" } } } },
            "401": { description: "Invalid credentials" },
          },
        },
      },
      "/api/auth/refresh": {
        post: {
          tags: ["auth"],
          summary: "Rotate refresh token",
          security: [],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { refreshToken: { type: "string" } } } } } },
          responses: { "200": { description: "OK" }, "401": { description: "Invalid/expired/reused token" } },
        },
      },
      "/api/auth/logout": { post: { tags: ["auth"], summary: "Revoke refresh token", security: [], responses: { "200": { description: "OK" } } } },
      "/api/auth/me": { get: { tags: ["auth"], summary: "Current user", responses: { "200": { description: "OK" } } } },
      "/api/auth/verify-email": { post: { tags: ["auth"], summary: "Verify email", security: [], responses: { "200": { description: "OK" } } } },
      "/api/auth/forgot": { post: { tags: ["auth"], summary: "Request password reset", security: [], responses: { "200": { description: "OK" } } } },
      "/api/auth/reset": { post: { tags: ["auth"], summary: "Reset password", security: [], responses: { "200": { description: "OK" } } } },
      "/api/auth/2fa/setup": { post: { tags: ["auth"], summary: "Begin 2FA setup (returns TOTP secret + otpauth URL)", responses: { "200": { description: "OK" } } } },
      "/api/auth/2fa/enable": { post: { tags: ["auth"], summary: "Confirm & enable 2FA", responses: { "200": { description: "OK" } } } },
      "/api/auth/2fa/disable": { post: { tags: ["auth"], summary: "Disable 2FA", responses: { "200": { description: "OK" } } } },

      "/api/creators/profile": {
        get: { tags: ["creators"], summary: "Get creator profile & tier stats", responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/CreatorProfile" } } } } } },
        patch: { tags: ["creators"], summary: "Update creator profile", responses: { "200": { description: "OK" } } },
      },
      "/api/creators/cashout": {
        post: {
          tags: ["creators"],
          summary: "Request a cashout (requires KYC approved + 2FA + Idempotency-Key)",
          parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }],
          responses: { "202": { description: "Accepted" }, "403": { description: "KYC/2FA required" } },
        },
      },
      "/api/creators/cashouts": { get: { tags: ["creators"], summary: "Paginated cashout history", responses: { "200": { description: "OK" } } } },
      "/api/creators/kyc": {
        post: { tags: ["creators"], summary: "Submit KYC", responses: { "201": { description: "Created" } } },
        get: { tags: ["creators"], summary: "Get KYC status", responses: { "200": { description: "OK" } } },
      },

      "/api/payments/buy-coins": {
        post: {
          tags: ["payments"],
          summary: "Purchase coins via Stripe/M-Pesa/EVC Plus/e-Dahab",
          parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }],
          responses: { "201": { description: "Created" } },
        },
      },
      "/api/payments/wallet-balance/{walletToken}": {
        get: {
          tags: ["payments"],
          summary: "Get (or auto-create) wallet balance",
          security: [],
          parameters: [{ name: "walletToken", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/payments/wallet/link": { post: { tags: ["payments"], summary: "Link anon wallet to account", responses: { "200": { description: "OK" } } } },

      "/api/gifts/catalog": { get: { tags: ["gifts"], summary: "Active gift catalog", security: [], responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Gift" } } } } } } } },
      "/api/gifts/send": {
        post: {
          tags: ["gifts"],
          summary: "Send a gift (debits wallet, credits creator, emits NEW_GIFT_EVENT)",
          parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }],
          responses: { "201": { description: "Created" } },
        },
      },

      "/api/streams": { post: { tags: ["streams"], summary: "Start a stream", responses: { "201": { description: "Created" } } } },
      "/api/streams/{id}/end": { patch: { tags: ["streams"], summary: "End a stream", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/api/streams/live": { get: { tags: ["streams"], summary: "Currently live streams", security: [], responses: { "200": { description: "OK" } } } },
      "/api/streams/{id}": { get: { tags: ["streams"], summary: "Stream details", security: [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },

      "/api/challenges/start": { post: { tags: ["challenges"], summary: "Start a challenge", responses: { "201": { description: "Created" } } } },
      "/api/challenges/{id}/end": { post: { tags: ["challenges"], summary: "End a challenge", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/api/challenges/active": { get: { tags: ["challenges"], summary: "Active challenges for a stream", security: [], parameters: [{ name: "streamId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },

      "/api/leaderboard/top-senders": { get: { tags: ["leaderboard"], summary: "Top senders", security: [], responses: { "200": { description: "OK" } } } },
      "/api/leaderboard/top-creators": { get: { tags: ["leaderboard"], summary: "Top creators", security: [], responses: { "200": { description: "OK" } } } },

      "/api/follows/{creatorId}": {
        post: { tags: ["follows"], summary: "Follow a creator", parameters: [{ name: "creatorId", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Created" } } },
        delete: { tags: ["follows"], summary: "Unfollow a creator", parameters: [{ name: "creatorId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
      },
      "/api/notifications": { get: { tags: ["notifications"], summary: "List notifications", responses: { "200": { description: "OK" } } } },
      "/api/notifications/{id}/read": { post: { tags: ["notifications"], summary: "Mark read", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/api/reports": { post: { tags: ["moderation"], summary: "File a report", responses: { "201": { description: "Created" } } } },
      "/api/blocks/{userId}": { post: { tags: ["moderation"], summary: "Block a user", parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Created" } } } },

      "/api/public/creators/{username}": { get: { tags: ["public"], summary: "Public creator profile", security: [], parameters: [{ name: "username", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/api/public/streams/live": { get: { tags: ["public"], summary: "Public live streams", security: [], responses: { "200": { description: "OK" } } } },
      "/api/public/leaderboard/top-creators": { get: { tags: ["public"], summary: "Public top creators", security: [], responses: { "200": { description: "OK" } } } },

      "/api/public/webhooks/stripe": { post: { tags: ["webhooks"], summary: "Stripe webhook", security: [], responses: { "200": { description: "OK" }, "401": { description: "Invalid signature" } } } },
      "/api/public/webhooks/mpesa": { post: { tags: ["webhooks"], summary: "M-Pesa Daraja webhook", security: [], responses: { "200": { description: "OK" }, "401": { description: "Invalid signature" } } } },
      "/api/public/webhooks/evcplus": { post: { tags: ["webhooks"], summary: "EVC Plus webhook", security: [], responses: { "200": { description: "OK" }, "401": { description: "Invalid signature" } } } },
      "/api/public/webhooks/edahab": { post: { tags: ["webhooks"], summary: "e-Dahab webhook", security: [], responses: { "200": { description: "OK" }, "401": { description: "Invalid signature" } } } },

      "/healthz": { get: { tags: ["ops"], summary: "Liveness probe", security: [], responses: { "200": { description: "OK" } } } },
      "/readyz": { get: { tags: ["ops"], summary: "Readiness probe (checks DB + Redis)", security: [], responses: { "200": { description: "OK" }, "503": { description: "Not ready" } } } },
      "/metrics": { get: { tags: ["ops"], summary: "Prometheus metrics", security: [], responses: { "200": { description: "OK" } } } },
    },
  };
}
