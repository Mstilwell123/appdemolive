# Stripe checkout (test mode)

A founder pays for a launch on Stripe's hosted Checkout page. The launch stays in
`LAUNCH_TYPE_SELECTED` until Stripe's signed webhook confirms payment; only then does it move to
`PREPARATION`. The redirect back from Stripe is never treated as proof of payment.

## Flow

1. Launch page **Pay $499 / Pay $799** button (`components/checkout-button.tsx`) calls
   `POST /api/v1/launches/:id/checkout`.
2. The route (`app/api/v1/launches/[id]/checkout/route.ts`) checks sign-in, same-origin and launch
   ownership, then `startCheckout` (`services/launch-setup.ts`):
   - requires status `LAUNCH_TYPE_SELECTED`, a locked price, and no existing successful payment;
   - generates an order id and creates a Checkout Session for the launch's locked price snapshot,
     with metadata `order_id`, `launch_id`, `organization_id`, `launch_type`
     (idempotency key `launch-checkout:<order_id>`);
   - inserts a `launch_orders` row with status `pending`;
   - returns `{ url, orderId }`. The button redirects the browser to `url`.
3. Stripe returns the founder to
   - `/dashboard/launches/:id/checkout/success?session_id={CHECKOUT_SESSION_ID}` (shows the order;
     "confirming" until the webhook lands), or
   - `/dashboard/launches/:id/checkout/cancel` (nothing charged, launch stays on hold).
4. Stripe calls `POST /api/v1/billing/stripe/webhook`. The raw body is verified with
   `STRIPE_WEBHOOK_SECRET`; bad, missing or tampered signatures get **400**. For a paid
   `checkout.session.completed` (or `async_payment_succeeded`), `handleBillingEvent`
   (`services/billing.ts`):
   - rejects the event if the amount or currency differ from the launch's price snapshot;
   - records the payment in `launch_payments` (unique on the payment intent, duplicates ignored);
   - flips the matching `launch_orders` row from `pending` to `paid` and sets `paid_at`
     (only pending rows match, so replays change nothing);
   - moves the launch to `PREPARATION` (the database trigger `launch_payment_guard` refuses this
     without a succeeded payment).
   Processing errors return **500** so Stripe retries.

## Order record

`public.launch_orders` (migration `supabase/migrations/20260927000007_launch_orders.sql`):
`id`, `organization_id`, `launch_id`, `stripe_session_id` (unique), `status` (`pending` | `paid`),
`amount` (minor units), `currency`, `created_at`, `paid_at`, `updated_at`. A check constraint keeps
`paid_at` set exactly when status is `paid`. RLS: founders can read their own organization's
orders; only server code (service role) can insert or update. Abandoned checkouts stay `pending`.
Down migration: `drop table if exists public.launch_orders;`

## Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | yes | Server only. `sk_test_...` for test mode. Without it, billing is the mock and checkout is disabled. |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_...` signing secret for the webhook endpoint. Local: printed by `stripe listen`. Hosted: from the dashboard endpoint. |
| `ALLOW_LIVE_PAYMENTS` | live only | Must be `true` to use an `sk_live_` key; otherwise live keys fall back to the mock. |
| `NEXT_PUBLIC_SITE_URL` | optional | Base URL for Stripe success and cancel links. Defaults to the request host. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | not used | Checkout is hosted by Stripe, so no browser-side key is needed today. |

Put local values in `.env.local` (never commit it) and restart `npm run dev` after changing them.

## Registering the webhook

### Local (Stripe CLI)

```bash
stripe login                      # or export STRIPE_API_KEY=sk_test_...
stripe listen \
  --forward-to localhost:3210/api/v1/billing/stripe/webhook \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,charge.refunded
```

Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET` in `.env.local` and restart the dev
server. Keep `stripe listen` running while testing. (Replace 3210 with your dev port.)

### Hosted (Stripe dashboard, test mode)

Developers, then Webhooks, then Add endpoint: `https://<your-host>/api/v1/billing/stripe/webhook`,
events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`.
Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` for that environment.

## Manual test

1. Start the dev server and `stripe listen` (above).
2. Sign in as a founder whose launch is in `LAUNCH_TYPE_SELECTED` and open the launch page.
3. Click **Pay $799** (or $499). The button shows "Opening checkout…" and the browser goes to
   `checkout.stripe.com`.
4. Cancel path: click Stripe's back arrow. You land on the cancel page; the launch is still on hold.
5. Pay path: pay again with card `4242 4242 4242 4242`, any future expiry (e.g. 12/34), CVC `123`,
   ZIP `94107`. You land on the success page, which shows "Payment received" once the webhook lands.
6. Check: `stripe listen` shows `checkout.session.completed` answered with 200; the
   `launch_orders` row is `paid` with `paid_at`; `launch_payments` has one `succeeded` row; the launch
   is `PREPARATION` with a history entry "Payment confirmed by Stripe".

Automated: `npm test` (unit tests for event mapping and signature checks; database tests for the
order table's constraints, replay behavior and RLS).
