# xConfess Frontend

Next.js 16 App Router frontend for xConfess.

## Current Architecture

- Uses cookie-backed session auth and shared auth context
- App Router proxy routes in `app/api/*` talk to the NestJS backend
- `AuthProvider` and `AuthGuard` control runtime route protection
- Development-only auth bypass is available with `NEXT_PUBLIC_DEV_BYPASS_AUTH=true`
- NextAuth is not used in this codebase

## What the Frontend Covers

- confession feed and composer
- reactions, comments, and search
- messages, notifications, and profile settings
- admin moderation, reports, analytics, and user management
- Stellar anchoring and tipping surfaces

## Local Development

From the repo root:

```bash
npm run dev
```

Frontend only:

```bash
npm run dev --workspace=xconfess-frontend
```

Build:

```bash
npm run build --workspace=xconfess-frontend
```

## Environment

Useful frontend environment variables:

- `NEXT_PUBLIC_API_URL`
- `BACKEND_API_URL`
- `NEXT_PUBLIC_WS_URL`
- `NEXT_PUBLIC_DEV_BYPASS_AUTH` for local development only
- `NEXT_PUBLIC_STELLAR_NETWORK`
- `NEXT_PUBLIC_STELLAR_HORIZON_URL`
- `NEXT_PUBLIC_STELLAR_CONTRACT_ID`

## Error Handling & Resilience

The application implements a centralized error handling system to ensure UI stability and consistent developer feedback.

### 1. API Error Normalization
All `app/api/*` proxy routes use `createApiErrorResponse` from `@/lib/apiErrorHandler`.
- **Consistent Shape**: Returns `{ message, status, correlationId }`.
- **Structured Logging**: Automatic server-side logging with context and trace IDs.

### 2. Stellar Error Handling
Stellar-specific errors (wallet, network, contract) are handled by `handleStellarError` in `@/lib/stellarErrorHandler`.
- **User-Safe Messages**: Technical XDR errors are mapped to actionable user feedback.
- **Toast Integration**: Automatically triggers status notifications for transaction lifecycle events.

### 3. Offline Resilience
- **Inbox Handling**: The messages inbox detects backend connectivity issues and displays an offline state with manual retry triggers.
- **Skeleton Loaders**: Used across all data-fetching components to prevent layout shift during loading or failure states.

## Notes

- The frontend expects the backend to be running for real data.
- Some routes have offline-friendly UI states, but they still depend on backend responses.
- Do not reintroduce browser-local mock admin branches; use the dev bypass flag only in development.
