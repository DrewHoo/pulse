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
Every count is real users only, as the Mixpanel project's VisitorType custom
property sorts them: no bots (Bot Check's rules, plus the headless Mac at
1440x900 that crawled Putting Up Numbers from 2026-11-03) and none of Drew's
devices. The Query API can't read a custom property, so `worker/shape.ts`
writes the rules out (`realWhere`, `REAL_JQL`), and a change to VisitorType
has to land there too. The link previews are bots' fetches and stay as they
are.
A picker under the header switches the whole screen between sites: Putting
Up Numbers (the default, its own domain, with its pageviews by sport), Streak
King, Hostile Territory, Breathing Index (its own domain), the blog, and
everything; the choice rides in the URL as `?p=<key>`. A filter
matches the page URL from its host on, and the Pages list drops the filter's
own path. Each filter is its own set of Query API calls, so the filters are an
allowlist (`PATHS` in `worker/shape.ts`). It is
a static page on GitHub Pages at `https://drewhoover.com/pulse/` that reads a
Cloudflare Worker at `https://drewhoover.com/pulse/api/stats`; the worker holds
the Mixpanel service account and caches the answers (the hourly series five
minutes, the rest thirty). Mixpanel allows 60 queries an hour per project; when
it answers 429 the worker sends nothing for ten minutes and serves the day's
last good answer meanwhile, which the page notes with its age.

Putting Up Numbers' screen adds its three numbers (below) under the days. They
come from one JQL query that refreshes every six hours, about four calls a day,
so the hourly budget above doesn't move. A failed refresh keeps the last good
answer and doesn't ask again for thirty minutes, and the screen draws without
the numbers if it has none.

The page is not linked from the index site and carries `noindex`. The data is
gated by a bearer token the page sends from its `?k=` query. Open the page once
with `?k=<token>` and add it to the home screen from that address: the
installed app keeps the query, and it has its own storage, so a token saved in
Safari would not carry over.

The page deliberately does not load the index site's analytics embed, because
it reads the site's pageviews and must not add to them.

## The three numbers

Settled 2026-11-04, for `specs/strategy.spec.md` in Putting Up Numbers. A
changed definition resets the before, so a change here is a new number with a
new name. `worker/measures.ts` computes them, real users only.

A **session** is one visitor's events on puttingupnumbers.com with no gap of 30
minutes or more. Its day is the New York day of its landing.

A **landing** is a session's first pageview. A builder address (`/<sport>/build/`)
followed by a pageview at another path within 2 seconds is the site resolving
the address to a named page, so the landing is the named page.

An **act** is a `query`, a `find`, a `split`, an `open`, or a pageview at a path
other than the landing's. A window pick, a reload and an opened row's own
address aren't acts. JQL's time is in whole seconds, and a tie goes to the
`query`, `find` or `split`.

- **Hunting** is the landings whose first act was a `query`, `find` or `split`,
  over all landings. A landing with no act counts in the landings. Lower is
  better. The foot of the list says how many landings acted at all.
- **Instant** is the median `ms` of the `answer` events. The site sends `answer`
  after a `query`: the time from the pick to the frame after its page commits.
  A `query` that leaves the same page up, one a later `query` replaced, one a
  link overtook, and one in a hidden tab send none. `answer` starts with the
  site's deploy of 2026-11-04, so Instant has no before.
- **Depth** is the named pages a session, the mean over all sessions. A named
  page is a path outside the builder, counted once a session however the reader
  got there, the landing included.

Each number reads three windows: the last 7 days and the last 28, today among
them, and the 28 days before those. The team pages rows are the sessions that
landed on `/<sport>/teams/<team>/` itself, not its position pages or splits.
Instant has no such row.

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
