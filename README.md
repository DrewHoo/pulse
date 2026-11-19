# pulse

Two screens of drewhoover.com's visitors. The numbers screen counts them, and
the visitors screen (below) says what each one did.

The numbers are the visitors with their pageviews beside them:
this hour, today against yesterday at the same hour, the last seven days, how
many came back (today's visitors seen on an earlier day this week, and the
week's visitors seen on two or more of its days), the top
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
devices. Mixpanel's APIs can't read a custom property, so `worker/shape.ts`
writes the rules out (`realWhere` for the export, `REAL_JQL` for the three
numbers), and a change to VisitorType has to land there too. The link previews are bots' fetches and stay as they
are.
From 1000px wide the numbers screen is three columns: today's numbers over two
of them, the three numbers or the first list beside them, and the lists three
to a row.
A picker under the header switches the whole screen between sites: Putting
Up Numbers (the default, its own domain, with its pageviews by sport), Streak
King, Hostile Territory, Breathing Index (its own domain), the blog, and
everything; the choice rides in the URL as `?p=<key>`. A filter
matches the page URL from its host on, and the Pages list drops the filter's
own path (`PATHS` in `worker/shape.ts`). It is
a static page on GitHub Pages at `https://drewhoover.com/pulse/` that reads a
Cloudflare Worker at `https://drewhoover.com/pulse/api/stats`; the worker holds
the Mixpanel service account.

The worker counts the numbers from Mixpanel's raw export (`worker/numbers.ts`),
the same cached days the visitors screen reads (below), so a filter costs no
call and switching filters is free. Until 2026-11-17 they were fifteen Query
API calls a refresh for each filter, 54 an hour on Putting Up Numbers' screen
alone. Three things still come from the Query API, since the export can't
answer them: the link previews and Reddit's fetches (two calls each thirty
minutes, unfiltered), because the share worker's events are a bot's and the
export holds only real users'; and Putting Up Numbers' three numbers (below),
one JQL query over 56 days that refreshes every six hours, about four calls a
day. A failed refresh of either keeps the last good answer and doesn't ask
again for thirty minutes, and the screen draws without it if it has none.

Mixpanel allows 60 calls an hour; when it answers 429 the worker sends nothing
for ten minutes and serves the last good answer meanwhile, which the page notes
with its age.

The page is not linked from the index site and carries `noindex`. The data is
gated by a bearer token the page sends from its `?k=` query. Open the page once
with `?k=<token>` and add it to the home screen from that address: the
installed app keeps the query, and it has its own storage, so a token saved in
Safari would not carry over.

The page deliberately does not load the index site's analytics embed, because
it reads the site's pageviews and must not add to them.

## The visitors screen

Who was here since midnight ET, or over the last seven days, and what each
of them did, latest first. The picker beside the count switches the two, and
the week rides in the URL as `&span=week`.
`specs/visitors.spec.md` has the rules and the reasons, and
`specs/visitors/*.png` are the screen. The header's two words switch screens,
and the choice rides in the URL as `?v=visitors`.

A **visitor** is a browser, the events that share Mixpanel's `$device_id`. A
**visit** is a visitor's events with no gap of 30 minutes or more. A card is
one visitor: the site, time in view and how far down the page got, the place,
the device and where the visit came from, then its pages and the filters and
events on them. A tap opens the card (`&d=<id>`) to every page as a link to
the live address, every event name with its values, and the visit's events in
order. Above the cards, Arrivals counts the span's visits by source and
site, beside the same hours yesterday (`yday`) or the week before (`prev wk`),
and marks a source or a landing page as new when the two days before, or the
week before, had no arrival like it. The list shows 150 cards and a button for
150 more. From 1000px wide the screen is
columns, and the opened visitor reads in a pane beside the list.

The worker shapes all of it (`worker/visitors.ts`, with the names of sites,
pages and sources in `worker/names.ts`) from event names and property names.
Nothing names a site, so a new site, event or property needs no change here.

The events come from Mixpanel's raw export, not the Query API. Mixpanel
lists the export's 60 calls an hour apart from the Query API's, but on
2026-11-17 the two refused as if they were one count, so budget them
together. The export takes
`realWhere` as its `where`, so the real-user rules stay in the two places
they were. It answers whole UTC days, and a call over four days took 35
seconds where one day takes 3, so the worker asks a day a call: today's is
cached five minutes and a finished day's a day. Both screens read the same
days, so they're 12 calls an hour together, about 8 more a day for the
finished days, and 4 an hour for the link previews: about 16 an hour with
both screens open, of 60. The export also refuses a fourth call in one
second, so the worker asks two days at a time.

The numbers screen's Reddit section reads the week of days for "links people
arrived by": each address a visit from Reddit landed on, with its visitors and
when it first arrived. Reddit's referrer never names a thread, so a landing
address is the nearest thing to a link someone posted, one row a link
whichever posts and comments carry it.

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
4. Project id, timezone, the pageview event and the two Mixpanel hosts (the
   Query API's and the export's) are `vars` in `worker/wrangler.jsonc`.

## Dev

Two ways to run the page locally, both at `http://localhost:5173/pulse/`, and
neither needs `?k=`: Vite's proxy sends the worker's token itself
(`vite.config.ts`).

- `npm run dev:live` serves the page against the deployed worker at
  drewhoover.com, with the token from `.env`'s `PULSE_URL`. It reads the live
  worker's cache, so it spends no Mixpanel calls of its own, and it's the way
  to try a page change on real data before pushing it. A change to the worker
  isn't in it until `npm run deploy:worker`.
- `npm run dev` serves the page against a worker running beside it
  (`npm run dev:worker`), with secrets and the token from `worker/.dev.vars`
  (gitignored, beside the wrangler config). A dev worker on the real project
  spends the live app's hourly limit, and an afternoon of it emptied the hour
  on 2026-11-17; point `MIXPANEL_API` and `MIXPANEL_EXPORT` at a mock there, or
  replay a saved export.

`npm test` covers the shaping of Mixpanel's answers, `npm run typecheck` covers
the page, the Vite config and the worker.
