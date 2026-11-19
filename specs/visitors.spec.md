# Pulse: who's here and what they did

Started 2026-11-17. Status: chunks 1 to 4 built 2026-11-17 (Drew: "LGTM, implement it!"), each decision at its lean, and the numbers screen moved onto the export the same day ("The numbers on the day files"). Later that day the window became today since midnight ET, at Drew's word, and on 2026-11-19 a picker added the last seven days ("What the build changed"). Chunk 5 is parked. "What the build changed" at the end lists where the code differs from what was written first.

Pulse counts visitors. It can't say what one of them did. For that Drew opens Mixpanel's Events tab, filters out bots and himself, and reads the rows. This spec puts that on the phone as a second screen: the visitors of the last eight hours, latest first, each with where they came from and a few lines of what they did, and the events behind those lines one tap away.

It adds no address, view or card to any site. Pulse is `noindex` and has no card of its own.

The screenshots are the built screens at 390px on 2026-11-17, with that morning's real visitors: `specs/visitors/list.png`, `specs/visitors/arrivals.png` with a row open, `specs/visitors/visitor.png`, `specs/visitors/events.png`, and `specs/visitors/numbers.png` for the numbers screen in the new colors. `specs/visitors/desktop.png` (1440px) and `specs/visitors/desktop-narrow.png` (1100px) are the desktop, below.

## The use cases

1. Drew opens the screen and sees someone from New Mexico read thirty PUN CFB pages. He gets the pages grouped under their parent in three lines, not thirty events.
2. He sees a visitor land on `/teams/lsu/punters`, stay 7 seconds and leave. He taps the page's link, finds it stale or badly laid out, and starts a session to fix it.
3. He sees `direct → hostile territory` at 26 visitors against 0 in the same hours yesterday. Somebody shared the link somewhere with no referrer. (That one is real: 26 direct arrivals at `/` in the eight hours to 9:40 am ET on 2026-11-17, 24 of them iPhones, 8 from Chicago.)
4. He sees a referrer Pulse hasn't seen in two days, marked new.

## What the events look like

Measured from Mixpanel's raw export of 2026-11-15 to 2026-11-17, 3,180 events.

- 2,665 events were real users', 310 Drew's, 179 bots' and 26 the share worker's link previews, by the rules in `worker/shape.ts`.
- The eight hours to 9:40 am ET held 495 real events from 52 browsers. The median browser sent 3 events, ten sent more than 10, and one sent 131.
- No browser in those eight hours was on two sites. One of 170 was in 24 hours.
- Every real event's `distinct_id` is `$device:<uuid>` and it carries `$device_id`. The share worker's events have ids like `unfurl:imessage` and no `$device_id`, and they pass the real-user rules.
- The project had 29 event names in three days. Most carry properties of their own: `coach_open {coach}`, `venue {venue}`, `definition {chips, dir, scope}`, `team open {team, len, scope, vs}`, `query {words}`, `Post read {seconds, max_scroll_percent}`.
- Every site sends a page view on every address change, and the query string is the page's state. Hostile Territory's search box sends one a keystroke (`?q=K`, `?q=Ki`, `?q=Kif`). 117 of the window's 313 page views were replaced by another within two seconds.
- `leave` comes from PUN, Streak King, Hostile Territory and the records board. It carries the running `seconds` in view, `scroll`, `taps` and `views` for one `load`, sent again each time the tab hides, so the last one for a `load` is the total. 44 of the window's 53 visits had one.
- `$referrer` stays on every page view after the landing. ChatGPT sends `utm_source` and no referrer. Reddit's referrer is `https://www.reddit.com/` or `android-app://com.reddit.frontpage/`, never the thread, so the landing page is the only lead to which link was posted.
- `site` is on every event but the index site's and the blog's. PUN's home sends `sport: nba`.
- `current_page_title` is on every page view, but on Hostile Territory an address change sends the title from before it. So the screen doesn't show titles.

## Where the events come from

The worker asks Mixpanel's raw export, `data.mixpanel.com/api/2.0/export`, in one call. Probed on 2026-11-17 with the service account:

- `from_date` and `to_date` are whole UTC days for this project. The eight hours cross UTC midnight from 7 pm to 3 am ET, and then the call asks for two days.
- `where` takes `realWhere` as it is. Today's export was 861 events without it and 794 with it.
- `time_in_ms=true` gives UTC milliseconds, which orders a page view and the event that caused it.
- The call took 3 seconds and answered 1.0 MB for 14.6 hours. The newest event was one to three minutes old.
- A three-day call repeated rows about 2.6 times and a one-day call didn't. The worker drops repeats by event, `distinct_id` and `$insert_id`.
- The shaped answer for the eight hours was 132 KB, 13 KB gzipped. For 24 hours it was 412 KB and 44 KB.

Mixpanel's rate-limit page lists the export at 60 calls an hour, apart from the Query API's 60. No sentence says the two are separate buckets. The numbers screen already spends 54 of the Query API's 60 an hour on PUN's filter, so this matters, and chunk 1 checks it.

JQL was the other choice. It can filter to the exact window and Pulse already uses it twice. But a JQL call counts against the Query API's hour, and Mixpanel's docs say JQL is in maintenance mode and recommend moving off it.

## The words

- A **visitor** is a browser: the events that share a `$device_id`. An event without one is the share worker's and isn't a visitor.
- A **visit** is a visitor's events with no gap of 30 minutes or more. It's the README's session, without the limit to one site.
- A visit's **source** is its first event's `utm_source`, else its `$referrer`, else direct.
- A page view is **passing through** when the same visitor's next page view comes within 2 seconds. That covers typing in a search box, a site's own redirect (PUN's and Streak King's builder addresses) and a one-second glance. The numbers screen already uses 2 seconds for PUN's builder (`RESOLVE_SECONDS`).
- A page's **state** is a query string it was seen with. Its last state is the one the visitor left it in.

## Site and page names

One function reads an event's `$current_url`, `site` and `sport` and answers the site's label, the page under it and the query string. It needs no change for a new site or sport.

| the event | label | page |
|---|---|---|
| `site: cfb-streak-king` | streak king | the path after `/cfb-streak-king` |
| `site: hostile-territory` | hostile territory | the path after `/hostile-territory` |
| `site: cfb-all-time-records` | all-time records | the path after `/cfb-all-time-records` |
| any other `site` | the slug with spaces for hyphens (`how many rings`) | the path after `/<site>` |
| puttingupnumbers.com, a path under a sport | `PUN` and the `sport` in capitals (`PUN CFB`, `PUN SOCCER` at `/european-clubs/`) | the path after its first segment |
| puttingupnumbers.com at `/` | `PUN` | `/` |
| drewhoover.com `/blog/…`, no `site` | blog | the path after `/blog` |
| anything else | the host without `www.` | the whole path |

A page loses its trailing slash, and the site's own root is `/`. The query string is decoded (`c=fullmoon,vsmascot:canine`) and kept apart from the page. `streak king` and `all-time records` are the table's only two rows that a rule can't derive, so they're a two-entry map. A site not in the map still reads fine.

A source gets the same treatment. `utm_source=chatgpt.com` is `chatgpt`. Reddit's web, old, out and app referrers are all `reddit`, as `redditViews` has them today. Any other is `outsideName`'s host and path, and a referrer with no path loses its `.com`: `google`, `bing`, `duckduckgo`, `search.yahoo`. One of Drew's own domains reads like any other (`drewhoover.com/sports`).

## What a visit's summary holds

The rules read event names and property names. None of them names a site.

1. **Pages.** The visit's page views that weren't passing through, grouped by page, each with its count and its states. The first is the landing and the last is where they left.
2. **Pages under one parent.** Two or more pages that differ only in their last segment read as the parent and its children: `/coach/ 4: kirby-smart, kalen-deboer +2`.
3. **Filters.** Each query parameter seen on those views, with its distinct values: `venue all, home`. A value the parameter's next value starts with is typing and is dropped (`Jos` before `Josh`), unless it's a number (`min=1` before `min=10` is two picks). A `utm_` parameter is the visit's source and not a filter.
4. **Events.** Every other event but `leave`, grouped by name, with a count and each of its own properties' distinct values: `definition ×4 chips overall, confgame · dir L · scope active`. An event with one property of its own shows the values alone (`coach_open ×7 Kirby Smart, Kalen DeBoer, Ryan Day +1`). A numeric property reads as its range (`ms 80–212`).
5. **An event's own properties** are the ones that aren't Mixpanel's (`$…`, `mp_…`, `current_…`, `utm_…`) and aren't the embeds' (`site`, `sport`, `framed`, `user_agent`). A new event or a new property shows up with no change to Pulse.
6. **Time in view** is the sum of each `load`'s last `leave.seconds`, with the deepest `scroll` beside it. A visit with no `leave` shows its last event's time minus its first's, marked `~`.
7. **A one-page visit** has one page, no filter and no event. 21 of the window's 53 were. Its card is dimmed, so the visits that did something stand out.

Over the eight hours these rules turned 495 events into 223 lines. The visitor with 131 events came out as 4.

## Color

Pulse takes Putting Up Numbers' default theme, the tokens at the top of that repo's `site/src/styles.css`: the plum field `#282127`, `#453a42` for rules, cream `#efe6d9` for words and `#bfb2a6` for small print. Three colors have one job each:

| color | its job | where |
|---|---|---|
| rust `#e0844a` | the site | a card's site name, the lit chip, the opened card's left edge, `new` |
| sky `#8fbcd0` | where they came from and went | a source that isn't direct, `landed`, `left` |
| gold `#d8c27a` | a count or an event | the visitor count, an arrival's visitors, an event's name |

A one-page visit's site name is small-print cream, so rust marks the visits that did something. The rust is lighter than PUN's `#c36c36`, which is 4.1:1 on the plum at 13px. `#e0844a` is 5.7:1.

**Decisions the spec owns.**

1. Whether the numbers screen takes the theme too. My lean is yes. Both screens read the same variables (`--bg`, `--fg`, `--mute`, `--accent`), so one set of tokens is less CSS than two, and the numbers screen's amber becomes the gold. It isn't mocked.
2. Whether a site gets its own color. My lean is no. Rust for every site needs no table, and the chips already filter by site.

## 1. The visitors, from the worker

`GET /pulse/api/visitors` answers the visitors of the last eight hours, shaped. `worker/visitors.ts` holds the shaping as pure functions with tests beside them, as `shape.ts` does. The page stays a renderer.

**Use case.** Any client, the page or a widget, asks one address and gets visitors with their visits, summaries and events.

**What happens if we drop it.** There is no screen.

**Object model changes.** A new group in the edge cache, `visitors`, holding the shaped answer. `Stats` doesn't change. Each visitor carries its place (`Chicago, IL`, or city and country code outside the US), device, browser, OS, screen size, first-ever source (`$initial_referrer`) and visits. Each visit carries its start, end, source, landing page, last page, summary and events. An event in the answer is its time, its name and one line of detail: a view's page and query, a `leave`'s totals, or the event's own properties.

**Decisions the spec owns.**

1. Export or JQL. My lean is the export, for its own hourly limit and because JQL is in maintenance mode. The price is whole UTC days of events for an eight-hour window, about 1 MB a day today.
2. How long the answer is cached. My lean is 300 seconds like the hourly series, 12 calls an hour. If the check below says the export's limit is its own, 120 seconds is affordable.
3. Whether the export's 60 is separate from the Query API's 60. The docs list them apart and don't say. The check is an hour with both screens polling and a count of 429s. If they share, the visitors screen takes the numbers screen's place in the budget, since the page polls only the screen it shows.
4. The window. My lean is eight hours fixed, as asked. `?hours=` is one line later if 24 turns out to be the question at breakfast. (Since 2026-11-17 it's today since midnight ET.)
5. A cap. My lean is 300 events a visitor in the answer, with the count of the rest. Today's busiest had 131.

**The cheap, fast version.** The worker passes the export through with Mixpanel's properties dropped and the page does the grouping. That's less worker code and the same screen, but the shaping can't be tested where `shape.test.ts` tests everything else.

## 2. The visitors screen

`specs/visitors/list.png`. The header gets two words, `numbers` and `visitors`, and the choice rides in the URL as `?v=visitors`, as `?p=` does. The screen is the count, a row of site chips, and the cards, latest first.

A card is four lines at most:

```
hostile territory                    1m 2s · 50% · 9:29a
Chicago, IL · iPhone · direct
/ ×5 · /coach/lane-kiffin ×2
q Kiffin · min 1 · coach_open ×3 Lane Kiffin
```

1. The site, then time in view, deepest scroll and the time of the last event.
2. Place, device and source.
3. The pages, the landing first.
4. The filters and the events. An event named for a filter already on the line (`venue`) is left to the opened card.

A visitor with two visits in the window shows the latest and says `2 visits`.

The chips are the sites in the answer with their visitor counts. They filter the cards in the page and cost no call, so they need no allowlist like `PATHS`.

**Use case.** Use cases 1 and 2. Two very active visitors are two cards, each ordered by its own last event, and their events never mix.

**What happens if we drop it.** Drew keeps opening Mixpanel's Events tab on a phone.

**Object model changes.** None in the worker. The page keeps the screen's last answer in `localStorage` under its own key, as it does for each path filter, so the screen opens on cards.

**Decisions the spec owns.**

1. Whether the visitors screen follows the numbers screen's site picker. My lean is no: the chips are built from the events and cover every site, and the picker's allowlist exists for a budget this screen doesn't spend.
2. Which screen Pulse opens on. My lean is the one last shown.
3. Whether a one-page visit is dimmed or hidden behind a chip. My lean is dimmed, its site name out of rust. Hiding it hides the answer to "where are people dropping".
4. How many cards. My lean is all of them, since 52 cards is a short scroll. Over 150 it shows the latest 150 and a "show the rest".

**The cheap, fast version.** Lines 1 to 3 only. The filters and events wait for the opened card.

## 3. A visitor, opened

`specs/visitors/visitor.png`, and `specs/visitors/events.png` with the event list open. A tap opens the card in place. The URL keeps `&d=<the id's first 8 characters>`, so a reload opens the same card.

The opened card says each thing once. Its first two lines stay as they are. The pages line and the filters line go, and three blocks take their place:

```
hostile territory                    3m 51s · 45% · 9:05a
San Leandro, CA · Android · from reddit
Chrome · 369×906 · 9:01a–9:05a · 36 taps · c17a275c

Pages  15 views, 1 passing through
/ ?venue=all&cut=25  landed                           ×9
   also  ?cut=25  no filter  ?venue=all  ?venue=home
/coach/kirby-smart ?venue=all
/coach/kalen-deboer ?venue=all
/coach/ryan-day ?venue=all&cut=25
/coach/josh-heupel ?venue=all&cut=25&min=1  left      ×2
   also  ?venue=all&cut=25

Events
venue       ×3  all, home
coach_open  ×7  Kirby Smart, Kalen DeBoer, Ryan Day +1

▸ All 26 events
```

- **The facts line** holds only what the two lines above it don't: the browser, the screen size, the visit's start and end, the taps and the short id. The OS is left out because the device says it. The first-ever source shows only when it differs from this visit's. A bot that got past the rules is recognizable here, and its screen size is what goes into VisitorType.
- **Pages.** One row a page, in the order first seen, linking to the live address in its last state. `landed` and `left` are tags on their rows. A page seen in other states lists them under it as links, and `no filter` is the page with no query string. This is the step in use case 2.
- **Events.** One row an event name, as rule 4 has it. This is the one place an event named for a filter appears.
- **All 26 events** is closed until tapped. Open, it's the visit's events oldest first: time, name, and the page or the event's own properties. A page view that was passing through is dimmed. A `leave` reads as `58s · 55% · 4 taps`.
- Earlier visits in the window follow, each closed under its own line.

The first mockup of this card said most things twice: the summary lines again as blocks, time in view and scroll again in a facts line, the landing and the last page as a sentence, the OS beside the device, and the same query string as a chip under every page. Drew asked for the repeats out on 2026-11-17.

**Use case.** Use case 2, and the option to dig that the summary isn't.

**What happens if we drop it.** The card's four lines are all there is, and a page can't be opened from Pulse.

**Object model changes.** None.

**Decisions the spec owns.**

1. Open in place or a screen of its own. My lean is in place, with the address holding which card is open.
2. Whether a page link opens with `?notrack=1`. My lean is no. Drew's devices are already out of the count by id, and the parameter would change what some pages draw.
3. Whether the event list shows every property or only the event's own. My lean is its own. Mixpanel's are the same on every row of a visit and are in the card's first lines.
4. Whether a page links to its last state or its first. My lean is the last, since that's the page as the visitor left it. The landing's exact address is the first row of the event list.

**The cheap, fast version.** The pages as links and the raw event list. The per-event rollup waits.

## A desktop

Built 2026-11-17 (Drew: "can you make or show me a desktop version, too?"). From 1000px the visitors screen is columns, and the opened visitor reads in a pane of its own.

- **1000px to 1279px.** Arrivals over the cards on the left, the pane on the right.
- **1280px and up.** Three columns: Arrivals, the cards, the pane. `main` grows to 1320px.
- **The card keeps its two summary lines** when it's open, since its blocks are in the pane. The pane repeats the card's first two lines so it reads on its own.
- **The page scrolls the cards.** Arrivals and the pane keep their place, and a pane taller than the window scrolls itself. A refresh puts the pane back where the reader was, if it still shows the same visitor.
- **Nothing open** leaves the pane saying to pick a visitor. Opening the latest one by default would swap the pane under a reader each time a newer visitor arrived.
- **The opened visitor stays in the pane** when a chip or a landing page filters its card out of the list.
- **Narrowing the window to a phone** moves the opened visitor back into its card. The page decides at 1000px (`matchMedia` in `src/main.ts`) and sets `wide` on `main`, so the CSS and the render agree.

The numbers screen got its own the same day (Drew wants Pulse as his own Mixpanel view, read from the desktop more). `specs/visitors/numbers-desktop.png` at 1440px, `numbers-desktop-narrow.png` at 1100px.

- **Three columns from 1000px.** Today's numbers (the hour, the bars, the strip, the week) take two of them, so the hours read wide. Beside them sits Putting Up Numbers' three numbers, or on another filter the first list, Referrers. The lists follow three to a row, so a page's path mostly fits where a phone cuts it at 20 characters.
- **The hours chart's labels are HTML now,** under and over the SVG. The SVG stretches to its width, and text inside it grew with it.
- **The phone is unchanged.** The new wrappers (`.numbers`, `.today`) only lay out under `main.wide`.

## 4. Arrivals

The table at the top of `specs/visitors/list.png`. One row a source and site: today's visitors, and the same hours yesterday.

```
direct → hostile territory     26    0
google → streak king            6    4
reddit → hostile territory      5    4
```

A row opens to its landing pages with a count each, and a tap on a landing page filters the cards to it. A row whose source and site have no arrival in the two days before the window is marked `new`. A landing page gets the same mark, which is how a new Reddit link shows up when Reddit's referrer never changes.

**Use case.** Use cases 3 and 4.

**What happens if we drop it.** The numbers screen's Referrers list still has today against the week for one site at a time. It can't say which page a referrer sent people to, or that a referrer is new.

**Object model changes.** The export asks from two UTC days back, a day a call (see "What the build changed"). The answer gains `arrivals`: source, site, visitors, visitors yesterday, new or not, and the landing pages.

**Decisions the spec owns.**

1. What "picking up" is measured against. My lean is the same hours yesterday, as the hero's "vs yday so far" does. The eight hours before would compare a morning with a night.
2. How far back "new" looks. My lean is the two days the export already holds. The dearer version is one segmentation call on `$referrer` over 14 days, two calls an hour from the Query API's budget, and it would say "new in two weeks".
3. Whether direct is a row. My lean is yes. Use case 3 is a direct row.

**The cheap, fast version.** The window's rows with no yesterday and no `new`. It needs no more export than chunk 1.

## Reddit links on the numbers screen

Built 2026-11-17 (Drew: "is there a way to reflect unique posts and comments here, even if it's only by heuristic? I suspect the first place a person lands on with reddit as a referrer can be counted"). `specs/visitors/reddit-links.png`.

The numbers screen's Reddit section gets "links people arrived by, 7 days": each address a visit from Reddit landed on, its visitors, when it first arrived, and `new` when that was in the last day. Each row links to the address. The list follows the screen's site picker.

Measured over 2026-11-15 to 2026-11-17:

- Reddit sent 42 visitors and the section's "links Reddit fetched" list was empty. That list is the share worker's, which reports nothing for Hostile Territory, the blog or a prerendered page.
- Reddit's referrer was `https://www.reddit.com/`, `https://out.reddit.com/` or `android-app://com.reddit.frontpage/`, and never a thread.
- The 42 visitors landed on 6 addresses. The same visitors' Reddit-referred page views covered 38 URLs, since the referrer stays on every view after the landing. So the list is landings, which only the visits can say, and not page views, which is all a segmentation call can count.

What the list can't say, which Drew named when he asked: it's one row a link and not one a post or a comment, so two comments with the same link are one row. A link nobody clicked isn't in it. A site's own redirect can put one link in two rows (`/?c=…` and `/build?c=…`).

Traffic stays at the link. `reddit-scan`'s privacy rule is that a Reddit author is never matched to a visitor, so a row counts visitors and the visitors screen's cards say only "from reddit".

**Object model changes.** `Stats` gains `redditLandings`. The worker's day cache is shared by both screens. `landingsFrom(source, …)` takes any source, and Reddit is the one the screen asks for.

**Decisions made.**

1. The numbers never waited for the export at first: the list refreshed behind the answer. Since the numbers moved onto the export (below) it comes with them.
2. The most visitors first, then the newest. A link from Saturday with 25 visitors stays above a new one with 1, and `new` marks the new one.
3. The share worker's "links Reddit fetched" stays under it. It's the only thing that sees a link at the moment it's posted, before anyone clicks.

**Not built: the posts and comments themselves, and their upvotes.** `reddit-scan` finds them through the Arctic Shift archive: a link post in any sub is one query, and a comment can only be searched a subreddit at a time, about an hour behind, at 70 minutes for 48 hours of fifteen subs. So that's a scheduled job writing a file Pulse reads, pointed by a `new` row here at what to look for. Current scores need Reddit's own API, which refuses a logged-out request, and the skill's read-only app is off until Drew applies for one. "Recent upvotes" is a score kept over time, so it also needs storage and a schedule, which Pulse has neither of.

## The numbers on the day files

Built 2026-11-17 (Drew: "I'm wondering if there's a way to cut down the data fetching. I'd even consider trashing the numbers view entirely", then "Rebuild on day files"). `specs/visitors/numbers-day-files.png`.

The numbers screen asked the Query API fifteen questions a refresh, seventeen on Putting Up Numbers, for each filter: 54 calls an hour polled, of the 60 the two APIs seem to share. Everything on it but two parts reads a week or less, and the export's days already held that week for the Reddit list. So `worker/numbers.ts` counts the hours, the days, the lists and who came back from those days, and a filter cuts the events in the worker instead of being a query of its own.

What stays on the Query API: the link previews and Reddit's fetches, because the share worker's events are a bot's and the export's `where` drops them, two calls each 30 minutes in one group for every filter; and the three numbers, one JQL call each 6 hours, since they read 56 days.

Checked against the live Query API on 2026-11-17 at 1:10 pm ET, Putting Up Numbers: the hours, the days, the totals, the referrers, AI assistants, sports and who came back matched to the visitor. The pages differed, and the export's are the right ones: the segmentation call kept its top 60 pages by week, so a page seen once or twice this week fell off the list.

**Decisions made.**

1. Who came back reads this week, not 30 days. "Returning today" is today's visitors seen on an earlier day this week, where it was an earlier day in the last 30. On 2026-11-17 both said 0 for Putting Up Numbers. The 30-day count would be one JQL call an hour if the week turns out too short.
2. A visitor is a `$device_id`, where the Query API counted distinct ids. They're the same browser for a reader who never signs in, and the check above matched to the visitor.
3. The numbers wait for the days. Today's day is about 3 seconds when its five minutes are up, and a cold week about 12, which happens when the cache is lost. A finished day's cache no longer ends at the project's midnight, since its name holds its UTC date.
4. The link previews draw as "Mixpanel didn't answer" when the Query API fails, and the rest of the screen draws. A refused export still fails the screen, since it's the numbers.

## 5. The link preview behind a direct arrival

Parked until 4 is in use. The share worker reports a preview when a link is pasted into iMessage, WhatsApp or Discord, and the click that follows arrives direct. In three days 6 of 17 previews were followed within 30 minutes by a direct landing on the same path, four landings in all. So a direct visit could say `direct, after an iMessage preview 17s before`.

It's a lead and not a fact. The sender's own phone fetches the preview too, so a match can be the sender.

## What this spec leaves out

- Whether a visitor has been here before the window, beyond the days the screen reads. `$initial_referrer` is the nearest thing the events carry, and the opened card shows it.
- Bots and Drew's own visits. The export is filtered by `realWhere` before it reaches the worker. A way to see what the filter dropped is a separate question.
- Totals by landing page across visitors. Eight hours is 52 visitors and most pages have one landing, so the cards are the better read for now.
- A third copy of the real-user rules. The export takes `realWhere`, so the rules stay in the two places they're in.

## What the build changed

Found on 2026-11-17 while building, each one now in the code and its tests.

- **A day a call.** One export call over four days took 35 seconds and answered 15.8 MB, with rows repeated 3.5 times. One day takes 3 seconds and repeats nothing. So the worker asks one UTC day a call, caches today's for 300 seconds and a finished day's for a day. A cold answer took 5.7 seconds for three days in parallel, and a cached one 17 ms. That's 12 export calls an hour and three or four more a day.
- **Two export calls at a time.** The export refuses a fourth call in one second. Eight days asked four at a time were refused, and the visitors screen would have been too on a night its window crossed UTC midnight and needed four days. A test holds it at two.
- **The export has its own 429 marker.** A refused export doesn't stop the numbers screen asking the Query API, and the reverse. If the two are one bucket, the markers could be one too. Two cost nothing: each API's first refused call sets its own.
- **The two limits look like one bucket** (chunk 1, decision 3). At 12:05 pm ET on 2026-11-17 the export answered 429, "rate limit reached", with `retry-after: 2534`. The hour before held about 24 export calls and about 55 Query API calls, all from local dev runs against the real project, and the live app was drawing on the Query API too. An export limit of its own wouldn't refuse at 24. It isn't proven: eleven export calls got through in the three minutes after the Query API first refused. Treat it as 60 an hour for both until an hour's count says otherwise.
- **The budget under one bucket.** The numbers screen on Putting Up Numbers was 54 calls an hour polled without pause, and 56 with the Reddit list's two. The visitors screen is 12. Since "The numbers on the day files" both screens read the same days, about 16 an hour together. A dev worker pointed at the real project spends the live app's hour, which is how this was found: work against a mock (`MIXPANEL_API` and `MIXPANEL_EXPORT` in `worker/.dev.vars`) or a saved export.
- **The typing rule got narrower.** The first rule dropped any value that another value starts with, which dropped `min=1` beside `min=10`. A test caught it.
- **Which property an event shows on a card.** The one with the most distinct values, words before a number or a true/false. `team open` shows the team, not its `len`.
- **The numbers screen lost its `h1`.** The header's left side is the two screens' names now, and the lit button in the picker already says the site.
- **The numbers screen took the theme** (Color, decision 1 at its lean). Its amber is the gold.
- **The card's choices are the worker's.** The pages under one parent, the property an event shows, and the event a card leaves out for its filter are fields of the answer (`pageGroups`, `cardValues`, `namedForFilter`), so `worker/visitors.test.ts` holds them. The first build made them in the page.
- **A `utm_` tag showed as a filter and in the page's address.** ChatGPT's `?utm_source=chatgpt.com` printed on the card beside "from chatgpt", made a one-page visit look like it did something, and rode on every landing page in Arrivals. It's left to the source now, and a page's link still carries it.
- **A list the reader opened stays open over a refresh.** The page repaints whole every five minutes, so it reopens each open `<details>` by its key.
- **The window is today since midnight ET, not the last eight hours.** Drew asked for it the evening of 2026-11-17, after the screen shipped. It matches the numbers screen's "today", and yday is midnight to the same time yesterday. Just after midnight the list is nearly empty, the same way the numbers screen's today is. The answer grows through the day: the spec measured 24 hours at 412 KB, 44 KB gzipped. The worker now reads four UTC days, since the day can be 25 hours on the night the clocks go back and "new" looks 48 hours before it. A finished day is cached for a day, so that's one more export call a day.
- **A week beside today** (2026-11-19, Drew: "a version of the page that lets me see data going back a week", with yday becoming prev wk). The count's line has a picker, `since midnight · 7 days`, and the week rides in the URL as `&span=week` and in localStorage like the path. The week starts at midnight six days ago, so it's the same seven days as the numbers screen's bars. `prev wk` is the same hours shifted back seven days, and `new` means the week before had no arrival like it. The worker reads 15 or 16 UTC days for it (`spanHours` in `worker/visitors.ts`): the first load after the deploy fetched the 7 the numbers screen didn't already hold, and after that it's one more export call a day. A card's time names its weekday when it isn't today. A week is 800 or so visitors, so the list shows 150 cards and a button for 150 more, where the rest used to sit in a closed list the page still drew. `specs/visitors/week.png` and `week-desktop.png` are the week on 2026-11-19: 909 visitors, 215 KB over the wire and 0.4 seconds warm. The first load after the deploy took 57 seconds for 11 days, after one try where Mixpanel's export timed out (a 524 from its side) on an older day.
