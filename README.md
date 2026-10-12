# demo-shop

> **A demo app of the swhurl platform.** With [demo-orders](https://github.com/samclement/demo-orders), [demo-shopper](https://github.com/samclement/demo-shopper) and [demo-notifier](https://github.com/samclement/demo-notifier) it shows how apps on the platform work together. This one shows:
>
> - **Calling another app securely.** `swhurl.yaml` says `calls: [demo-orders]`; `service("demo-orders")` in `src/app.ts` then has its address and sends a short-lived token only demo-orders accepts. Nothing about the cluster is in this repository.
> - **Who is calling.** A signed-in person (the shop is behind the platform's sign-in) or another app (demo-shopper): `GET /` and `POST /buy` answer both and say which.
> - **A described API.** `openapi.json` is generated from the routes; the platform's Catalogue lists them.
>
> Try it: open the shop's address and, signed in, `POST /buy?item=tea&quantity=12`. An order of ten or more makes demo-notifier tell the team.

Demo: the shop people open; it places orders by calling demo-orders with a platform token

A TypeScript app on the [swhurl platform](https://github.com/samclement/swhurl-platform), made from the [swhurl TypeScript template](https://github.com/samclement/swhurl-app-template-typescript). Every push to `main` is checked, published to `ghcr.io/<owner>/demo-shop` and deployed to staging; production changes through **Promote to production**. What the image must provide, the checks and the dependency updates: the [template's guide](https://github.com/samclement/swhurl-app-template-typescript#readme). What the app needs from the platform: [`swhurl.yaml`](swhurl.yaml).

An HTTP service on [Hono](https://hono.dev): `src/app.ts` holds the routes and `src/server.ts` listens on port 8080; the platform probes `GET /healthz`.

## Callers and calling other apps

`src/platform.ts` holds what the platform gives the app ([calling another app](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#calling-another-app)):

- **Who is calling.** `identify(headers)` returns `{ type: "app", id: "<app>" }` for another app that sent a token the platform issued for this app alone, `{ type: "user", id: "<email>" }` for a signed-in person, or `anonymous`. A bad token throws `Unauthorized`, which `src/app.ts` answers with 401. Every log line and span carries `caller.type` and `caller.id`. For a route only apps may use, call `requireApp(caller)`.
- **Calling another app.** Add `calls: [orders]` to `swhurl.yaml` before the app is created (afterwards: `make app-calls` on the platform, or the app page's **Calls** form). Then `await service("orders").fetch("/path")` reaches the same environment's `orders` with this app's token for it; the callee's spans join the same trace. `GET /call/orders` in `src/app.ts` is an example to replace.

## Notifications

`await notify("Order backlog", { message: "412 orders waiting", priority: "high" })` (from `src/platform.ts`) sends a message to the notification channel of the team that owns this app ([notifications](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#notifications)). Nothing is declared in `swhurl.yaml`: the platform gives every app the address and a token. The message arrives titled `<app>/<env>: Order backlog`. The call resolves to whether the platform accepted it and never throws; an app may send 30 an hour, and a team without a channel delivers nothing. `POST /notify` in `src/server.ts` is an example to replace. Locally there is no notify service: `notify` resolves to `false` and sends nothing.

## Events

`src/events.ts` publishes and receives events on the platform's NATS ([events](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#events)). Declare them in `swhurl.yaml` before the app is created (afterwards: `make app-events` on the platform):

```yaml
events:
  publish: [created]               # other apps see demo-shop.created
  subscribe: [orders.created]      # <app>.<event>
```

Then `await publish("created", data)` and `await subscribe("orders.created", async (event) => { ... })`. An event is a CloudEvents envelope (`event.data` is what was published); a handler runs inside the publisher's trace, and if it throws the event comes back, five tries in all. `src/app.ts` publishes the first declared event on every request to `/` and `src/server.ts` logs every event it subscribes to: examples to replace. `subscribe` keeps trying until it is receiving, since a new app can start before NATS knows it. Locally there is no NATS: `publish` returns `null` and `subscribe` never calls back.

## The API this app offers: `openapi.json`

Routes written with `createRoute` in `src/app.ts` carry their request and response schemas ([zod](https://zod.dev)), and [`openapi.json`](openapi.json) is generated from them ([OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0)); the app also serves it at `/openapi.json`. The platform reads the file to show other apps what they can call.

After changing a described route, run `npm run build && npm run openapi` and commit `openapi.json`: `test/openapi.test.mjs` fails while the file and the routes disagree, so a change to the API always shows in a pull request. A route added with plain `app.get(...)` works but is not described.

## Without the platform

Locally there are no platform keys or tokens: requests without a token work as before and a request with one is refused; to call another app, set `SWHURL_SERVICE_<NAME>_URL` to a local stub.

## Local development

```bash
npm install
npm run dev                             # the SDK stays off locally (the image turns it on)
curl http://localhost:8080/healthz
npm run check                           # type-check, as CI does
npm run build && npm test               # the tests run against the built app
```

To see telemetry locally, `npm run build`, then `OTEL_TRACES_EXPORTER=console node --import ./dist/instrumentation.js dist/main.js` prints spans (or run an OpenTelemetry collector on `localhost:4318` and drop the variable).
