# pulse

One screen of drewhoover.com's pageviews: this hour, today against yesterday
at the same hour, the last seven days, and the top referrers and pages. It is
a static page on GitHub Pages at `https://drewhoover.com/pulse/` that reads a
Cloudflare Worker at `https://drewhoover.com/pulse/api/stats`; the worker holds
the Mixpanel service account and caches each answer for five minutes.

The page is not linked from the index site and carries `noindex`. The data is
gated by a bearer token the page sends from its `?k=` query. Open the page once
with `?k=<token>` and add it to the home screen from that address: the
installed app keeps the query, and it has its own storage, so a token saved in
Safari would not carry over.

The page deliberately does not load the index site's analytics embed, because
it reads the site's pageviews and must not add to them.

## Setup

1. Mixpanel → Organization settings → Service Accounts → create one with
   access to the "personal website" project. Its username and secret become
   the `MIXPANEL_SERVICE_ACCOUNT` secret as `<username>:<secret>`.
2. Secrets, set once per worker and never committed:

   ```bash
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' | npx wrangler secret put PULSE_TOKEN -c worker/wrangler.jsonc
   npx wrangler secret put MIXPANEL_SERVICE_ACCOUNT -c worker/wrangler.jsonc
   ```

3. `npm run deploy:worker` from a wrangler-logged-in machine, or add the
   `CLOUDFLARE_API_TOKEN` repo secret and let `deploy.yml` do it on push.
4. Project id, timezone and the pageview event are `vars` in
   `worker/wrangler.jsonc`.

## Dev

`npm run dev` serves the page; `npm run dev:worker` serves the API beside it
and the Vite proxy keeps the two same-origin. The worker reads its secrets
from `worker/.dev.vars` (gitignored, beside the wrangler config); point `MIXPANEL_API` at a mock there to work
without a service account. `npm test` covers the shaping of Mixpanel's
answers, `npm run typecheck` covers both the page and the worker.
