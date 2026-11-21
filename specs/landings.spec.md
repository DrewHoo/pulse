# Pulse: where visits land and how far they go

Started 2026-11-20. Status: written and built the same day (Drew: "write it up and then build"), each decision at its lean, with tints on the numbers added that night ("Tints"). "What the build changed" at the end lists where the code differs from what was written first.

Pulse can say who came and what one of them did. It can't say which landing pages lead to more use, or which ones people leave in a few seconds. Drew asked for time on a site per day, pages a visit, the entry points that lead to deeper use, the way people get there, and the pages with a lot of landings and quick exits.

This spec adds a third screen, `landings`, and three figures under each day of the numbers screen. It needs no new Mixpanel call. Both read the days the two screens already cache.

## The use cases

1. Drew sees that `/teams/florida-state/kickers` on Putting Up Numbers took 9 landings, and 4 of the 5 that reported their time left in under 10 seconds. The median was 2 seconds. He opens the page and looks for what's wrong with it.
2. He sees that visits from on3 to Hostile Territory stay 95 seconds at the median and 67% of them stayed. Visits from Google to Putting Up Numbers' college football pages stay 31 seconds and 29% stayed. He knows which kind of link to chase.
3. He opens Hostile Territory's `/` and sees that 31 visitors went on to a coach page and 170 visits saw no other page. He sees `coach_open` on 34 visits, all 34 of them ones that stayed.
4. He looks at the numbers screen on Streak King and sees Wednesday had 35 visitors and 126 minutes in view, and Tuesday had 52 and 86.

All four are real, from the week to 2026-11-20.

## What the week looks like

Measured on 2026-11-20 from the visitors screen's answer for seven days, before anything was built: 1,115 visits from 938 visitors.

| site | visits | median time | pages a visit | saw a second page |
|---|---|---|---|---|
| Streak King | 316 | 45s | 1.96 | 30% |
| Hostile Territory | 231 | 86s | 1.38 | 19% |
| Putting Up Numbers | 394 | 26s | 1.14 | 10% |
| All-time records | 74 | 60s | 1.04 | 3% |

- The median visit is one page on every site. A board is one address, and a reader goes further by tapping. So pages a visit can't be the only measure of use.
- 906 of the 1,115 visits had a `leave`, which carries seconds in view, scroll and taps. The blog's 83 visits had none, and 126 visits on the other sites had none. 129 of those 209 had no time between their first event and their last.
- About half of the measured visits had no tap, and 77% of Putting Up Numbers'. 20% of Putting Up Numbers' were under 10 seconds, and 14% to 16% of the other three sites'.
- One visit reported 10,750 seconds in view. The next longest was 1,759.
- Putting Up Numbers had 215 landing pages, and 261 of its 394 landings were on a page with fewer than 5. 71 of them were a team's quarterbacks page, on dozens of teams.
- 233 of Streak King's 316 visits stayed on one page. `onePage` marks 50 of them, because Streak King sends `definition` when the page loads and `onePage` counts any event.
- A visitor rarely crosses sites. 6 visits of the 1,115 did.

## The words

The screen reuses the visitors spec's words: a visitor, a visit, a visit's source, a page view that is passing through. A visit **lands** on its first page that wasn't passing through, as it does there. Four words are new.

- A visit is **measured** when it has a `leave`. An unmeasured visit counts as a visit and a visitor, and in nothing else.
- A **quick exit** is a measured visit of under 10 seconds, on one page, with no tap.
- A visit **stayed** when it is measured and it saw a second page, or was 60 seconds in view, or had 3 taps.
- A **starred page** is several pages read as one row, with a `*` where they differ: `/teams/*/quarterbacks`, `/coach/*`.

Quick and stayed are shares of the measured visits. A visit can be neither. The three numbers already have a Depth, the named pages a session, so no figure here is called depth.

**Decisions the spec owns.**

1. The three thresholds. My lean is 10 seconds, 60 seconds and 3 taps. The week's measured visits were 17% quick and 45% stayed by these, which leaves room on both sides. They are constants in `worker/thresholds.ts`, and a change is a new number.
2. Whether an unmeasured visit with one event is a quick exit. My lean is no. `leave` is sent when the tab hides, so a one-second visit sends one. A visit without one is a browser that didn't report, and its time is unknown.
3. Whether `definition` and the other events a page sends on load count toward stayed. My lean is that no event does. Taps come from `leave` and need no list of which events a reader caused.

## Starred pages

A landing table with one row a page is 215 rows of one or two landings on Putting Up Numbers. The rule that fixes it names no site.

The pages are every page a visit saw on the site in the week, the landing pages and the ones after them. Within one site, two pages are alike when they have the same number of segments and differ in exactly one of them. A page with 4 or more pages alike in one segment reads as a starred page, with the `*` at that segment. If two of its segments qualify, the one with more pages wins. A page with one segment is never starred.

| the pages | read as |
|---|---|
| `/teams/boise-state/running-backs`, `/teams/ucla/running-backs`, and 2 more teams | `/teams/*/running-backs` |
| `/coach/joe-paterno`, `/coach/lane-kiffin`, and 2 more coaches | `/coach/*` |
| `/longest-home-win-streaks`, `/longest-road-win-streaks`, 60 more | each its own row |
| `/teams/hawks/goalies`, `/teams/kraken/goalies` | each its own row |

The one-segment rule keeps Streak King's and Putting Up Numbers' named pages apart. They differ in one segment and there are dozens, and each is a page somebody wrote a title for.

A starred row opens to its pages, each with its own counts and a link.

**Decisions the spec owns.**

1. Four pages or some other number. My lean is 4. At 2 a pair of pages loses its rows, and at 10 the long tail stays long.
2. Whether a page can take two stars (`/team/*/vs/*`). My lean is no. One pass over the pages is a rule a test can hold, and the week had 5 such landings.

## 1. The landings, from the worker

`GET /pulse/api/landings` answers the last seven days, from the midnight six days ago in the project's timezone. They are the same seven days as the numbers screen's bars. `worker/landings.ts` holds the counting as pure functions with tests beside them.

**Use case.** All four.

**What happens if we drop it.** There is no screen, and the page would have to count 1,100 visits from the visitors screen's 2.6 MB answer.

**Object model changes.** A new answer, `Landings`. Every row carries the same counts: visits, visitors, measured, quick, stayed, the median seconds in view, the seconds in view added up, and pages a visit.

- `sites`: a row a site.
- `sources`: a row a source and site, as Arrivals has them.
- `landings`: a row a landing page or starred page of one site. It also carries the pages under a star, its three biggest sources, the pages its visits went to next, how many visits saw no other page, and its events.

A visit's **next page** is the first page it saw that isn't its landing page, starred by the same rule. It counts visitors. An **event** on a landing row counts the measured visits that sent it and how many of those stayed.

The seconds added up count a visit at 30 minutes at most. The one visit of 10,750 seconds would otherwise be a third of a day's total.

**Decisions the spec owns.**

1. A route of its own, or more fields on `/visitors?span=week`. My lean is a route. The visitors answer is every event of 900 visitors, and this one is counts.
2. Seven days only. My lean is yes. A day's landings are mostly one visit a page, and the visitors screen already reads a day well. A span picker is a later line.
3. Whether a landing's next pages count visits or visitors. My lean is visitors. Streak King had 18 steps from its cover streaks board to a game page in the week, and one reader made 12 of them.
4. Whether the answer holds every landing row or the top of the list. My lean is every row. The page sorts them three ways and filters by site, and a cut made in the worker would be made on the wrong order.

**The cheap, fast version.** The `sites` and `landings` rows with their counts and nothing under them.

## 2. The landings screen

The header gets a third word, `landings`, and the choice rides in the URL as `?v=landings`. The screen is three lists with the same five columns: visits, quick, stayed, the median time, and pages a visit. `specs/landings/list.png` is the screen at 390px on 2026-11-20, `opened.png` is Hostile Territory with two rows open, and `quick.png` is Putting Up Numbers' college football sorted by quick exits. `desktop.png` and `desktop-quick.png` are 1440px.

```
Sites                         visits  quick stayed    time
streak king                      319    13%    52%     45s
hostile territory                231    16%    62%  1m 26s
PUN CFB                          217    19%    30%     29s

Sources                       visits  quick stayed    time
google → streak king             203    12%    57%   1m 4s
reddit → hostile territory        66    10%    68%  1m 50s

Landings                      visits  quick stayed    time
sorted by visits · quick · stayed
hostile territory /              205    13%    65%  1m 33s
PUN CFB /teams/*/quarterbacks     71    12%    35%     32s
streak king /build                38    33%    43%     23s
```

- **A site's row filters the screen** to that site, and the choice rides in the URL as `&site=`. The Sources and Landings lists follow it. A second tap clears it.
- **The Landings list sorts three ways**: by visits, by quick exits, by stayed. The last two sort by share and put a row with fewer than 5 measured visits after the rest, so one visit of one doesn't lead the list. The sort rides in the URL as `&sort=`.
- **A landing row opens** to four blocks: its pages when it's starred, where its visits came from, where they went next, and its events.

```
hostile territory /              205    13%    65%  1m 33s
   page     drewhoover.com/hostile-territory/
   from     direct 83 · reddit 65 · on3 48
   next     /coach/* 31 · /sports 2 · 170 visits saw no other page
   events   readnext shown 72, 46 stayed · venue 52, 49 stayed · coach_open 34, 34 stayed
```

- **A share with fewer than 5 measured visits is small print.** A row with no measured visit shows a dash.
- **From 1000px** the Sites and Sources lists sit in a left column and Landings takes the rest.

**Use case.** Use cases 1 to 3.

**What happens if we drop it.** Drew reads 900 cards and counts in his head.

**Object model changes.** None in the worker. The page keeps the screen's last answer in `localStorage` under its own key.

**Decisions the spec owns.**

1. Site rows or the visitors screen's chips. My lean is rows. The chip would say the site and its count, and the row says those and four more numbers.
2. Whether quick and stayed sort by share or by count. My lean is share, with the floor of 5. By count the biggest page leads every sort.
3. How many landing rows show. My lean is 30 and a button for 30 more.

**The cheap, fast version.** The Landings list alone, sorted by visits.

## 3. Time on the numbers screen's days

Each of the seven days under the bars gets three more figures: minutes in view, the median visit, and pages a visit. They follow the screen's site picker.

```
  40   45   41   52   35   28   39     visitors
  ▂    ▃    ▂    ▅    ▂    ▁    ▂
  S    S    M    T    W    T    F
 59m  48m  68m  86m 126m  64m 101m     minutes in view
 47s  26s  37s  49s 1m14  37s 1m46     the median visit
 2.0  1.3  1.6  1.8  3.2  1.5  2.3     pages a visit
```

That's Streak King on 2026-11-20, `specs/landings/numbers-days.png` and `numbers-days-desktop.png`.

A visit belongs to the day it started on and to the filter its landing page is under.

**Use case.** Use case 4.

**What happens if we drop it.** The landings screen has the week's figures for each site and no day has any.

**Object model changes.** Each of `Stats.days` gains `visits`, `seconds`, `median` and `pagesAVisit`. `Stats.v` becomes 6.

**Decisions the spec owns.**

1. Under the bars, or a list of its own. My lean is under the bars. The seven columns are already there, and a foot line says what the three rows are.

**The cheap, fast version.** The median visit alone.

## Tints

Built 2026-11-20 (Drew: "can you heatmap the numbers so it's easier to see mismatches... otherwise it's a lot of squinting and small number comparison"). Every screenshot in `specs/landings/` has them.

A number in the top quarter of its column gets a warm ground, and one in the bottom quarter a cool one. The top and bottom tenth get a stronger tint. The middle half has none. So a row with a warm visits cell and a cool stayed cell is a page that takes a lot of landings and keeps few of them, and it shows without reading a number. In the week to 2026-11-20 that was `/teams/*/running-backs` on Putting Up Numbers: 35 visits, 19% stayed.

- **A column is one list's rows.** Sites are compared with sites, and a landing page with the landing pages showing. With a site picked, its pages are compared with each other.
- **Only rows with 5 or more measured visits are compared,** and only they are tinted. It's the floor the small print already uses.
- **A tint says more or less, not good or bad.** A warm quick cell is a lot of quick exits. Drew asked for more and less, and the two readings of quick would otherwise need a rule for which columns flip.
- **Ties share a tint.** A number is in the top quarter when three quarters of the column is strictly under it, so ten pages with one visit each aren't the bottom quarter of anything.
- **A page under a star is tinted against the list,** as a row of its own would be. Florida State's kickers page shows warm on quick and cool on stayed inside `/teams/*/kickers`.
- **A column of fewer than 4 numbers has no tints.**

The warm is `#e0623a` and the cool `#4a8fd0`, mixed into the plum at 15% and 34%, and 14% and 32%. They're a fourth job beside the visitors spec's three colors, and they are only ever a cell's ground. The number keeps its own color. Cream, gold and small-print text are all 4.7:1 or better on the strongest tint. The two colors are 21 apart for a protan reader by the dataviz skill's validator, where 8 is its target. `src/heat.ts` holds the rule, with tests beside it.

**Decisions made.**

1. Quarters and tenths, constants in `src/heat.ts`. A single step at the quarter made a 100% and a 55% the same color.
2. Tinted in the page, not the worker. The column is the rows on the screen, which changes with the site picked.
3. The numbers screen isn't tinted. Its lists rank one number, and the bar behind each name already shows it.

## What this spec leaves out

- **Time on one page of a longer visit.** `leave` reports a page load, and a board changes address without loading. A one-page visit's time is its page's time, and that's 80% of visits.
- **The blog.** It sends no `leave`, so its rows have visits and dashes. It does send `Post read` with seconds and scroll. Reading that would be the first rule here that names an event of one site.
- **Whole paths.** A landing row has the next page and not the three after it. Hostile Territory's paths are `/` to a coach and back.
- **The query a visit landed with.** A row is a page whatever its state, so Streak King's `/build` is one row for every board somebody built. Arrivals on the visitors screen lists a landing page with its query.
- **A comparison with the week before.** Arrivals has `prev wk` for counts. A share that moved from 14% to 19% on 20 visits isn't news.
- **`onePage`.** The visitors screen's dimmed card still counts a page's own events. This screen doesn't read it.

## What the build changed

Found on 2026-11-20 while building, each one now in the code and its tests.

- **Quick exits came out lower than the first count.** The numbers I gave Drew before the spec called an unmeasured visit of one event a quick exit, and divided by every visit. By the rule here (decision 2 under "The words") Florida State's kickers page went from 8 of 9 to 4 of 5, and Putting Up Numbers from 26% quick to about 19%.
- **A phone shows four of the five columns.** Pages a visit shows from 1000px. At 390px the fifth column left a page's name 110px.
- **Sites and Sources show 8 rows** and the rest behind a tap. The week had 18 sites and 65 sources, which put Landings three screens down. The lit site's row shows even when it's one of the rest.
- **Under a share sort, the rows with fewer than 5 measured visits keep their order by visits.** Sorted by share they were a run of 100% rows of one visit each.
- **A starred row can have one landing.** The stars come from every page a visit saw, so Putting Up Numbers' `/players/*` is a row with one landing, because 4 or more player pages were seen as next pages. The same star then names the next page on other rows.
- **Streak King's game pages aren't starred.** `/game/2026-11-17/ball-state-at-ohio` differs from another game in two segments. They show as next pages one game a row.
- **The thresholds have a module of their own,** `worker/thresholds.ts`. The page prints them in its foot line, and importing them from `worker/landings.ts` put the three numbers' JQL in the page's bundle.
- **The answer is 120 KB** for 174 landing rows, 18 sites and 65 sources, and took 0.13 seconds from a warm cache of days.
- **Built against a saved export.** Eight days of the real-user export were saved to files, 8 calls, and a stand-in Mixpanel answered them to a dev worker, as the README says to. The first look at the week was a call to the live worker's `/visitors?span=week` from a machine whose cache didn't hold 12 of its 15 days, which cost 12 more.
- **A visit has a page view** (2026-11-21, `specs/visitors.spec.md`, "What the build changed"). The landings counted 114 runs of events with no page view as visits, each landing on its `leave`'s page with the whole page load's seconds. Most were a crawler that sends a `leave` and never a page view. Without them the week is 1,008 visits where it was 1,122, 18% quick and 48% stayed. Putting Up Numbers' men's college basketball went from 35 visits to 13 and the women's from 28 to 5, which were the direct visits that never stayed. Hostile Territory's `/` is 192 visits with 157 that saw no other page, on3 is 42 visits at 94 seconds, and Streak King's `/build` is 30 visits with 10 of its 22 measured ones quick. Florida State's kickers page is still 4 of 5. The figures and screenshots above this section are from before the rule.

