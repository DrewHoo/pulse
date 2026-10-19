# pulse

One screen of drewhoover.com's visitors, with their pageviews beside them:
this hour, today against yesterday at the same hour, the last seven days, how
many came back (today's visitors seen on an earlier day in the last 30, and
the week's visitors seen on two or more of its days, from one JQL query, since
the segmentation endpoints count visitors a bucket at a time), the top
referrers and pages, the apps Streak King links were shared in (the share
worker's link previews, whose clicks arrive with no referrer and read as
direct), the pageviews AI assistants sent (by `utm_source`, which ChatGPT and
Perplexity add in place of a referrer, else by the referring domain), and
Reddit: its referred views, and the Streak King links Reddit fetched this
week, each a lead to look up there (Reddit's crawler fetching a link post's
URL, or an `&amp;`-escaped fetch of a link in a post's or comment's text).
A picker under the header switches the whole screen between sites: Streak
King (the default), Hostile Territory, Breathing Index (its own domain), the
blog, and everything; the choice rides in the URL as `?p=<key>`. A filter
matches the page URL from its host on, and the Pages list drops the filter's
own path. Each filter is its own set of Query API calls, so the filters are an
allowlist (`PATHS` in `worker/shape.ts`). It is
a static page on GitHub Pages at `https://drewhoover.com/pulse/` that reads a
Cloudflare Worker at `https://drewhoover.com/pulse/api/stats`; the worker holds
the Mixpanel service account and caches the answers (the hourly series five
minutes, the rest thirty). Mixpanel allows 60 queries an hour per project; when
it answers 429 the worker sends nothing for ten minutes and serves the day's
last good answer meanwhile, which the page notes with its age.

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
