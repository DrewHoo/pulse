import { createMorph } from 'morphicons/dom';

// The icon beside "as of … · 2m ago" that says whether a fetch is in flight.
// While one is, the icon morphs from ball to ball (morphicons, spring physics);
// when it lands, the icon settles into a check, or an x if it failed.
//
// The screens are repainted by replacing their HTML, so the icon is one <svg>
// made once here: the header holds a placeholder, and main.ts puts this element
// back in it after each paint, so a morph in flight carries on.

// Stroke icons on a 24-unit grid. The balls are Tabler's (MIT) but the puck.
const BALLS = [
  'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M5.65 5.65l12.7 12.7M5.65 18.35l12.7 -12.7M12 3a9 9 0 0 0 9 9M3 12a9 9 0 0 1 9 9', // basketball
  'M15 9l-6 6M10 12l2 2M12 10l2 2M8 21a5 5 0 0 0 -5 -5M16 3c-7.18 0 -13 5.82 -13 13a5 5 0 0 0 5 5c7.18 0 13 -5.82 13 -13a5 5 0 0 0 -5 -5M16 3a5 5 0 0 0 5 5', // football
  'M3 9a9 3.5 0 1 0 18 0a9 3.5 0 1 0 -18 0M3 9v6a9 3.5 0 0 0 18 0v-6', // hockey puck
  'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M12 7l4.76 3.45l-1.76 5.55h-6l-1.76 -5.55l4.76 -3.45M12 7v-4m3 13l2.5 3m-.74 -8.55l3.74 -1.45m-11.44 7.05l-2.56 2.95m.74 -8.55l-3.74 -1.45', // soccer ball
] as const;
const CHECK = 'M5 12l5 5l10 -10';
const X = 'M18 6l-12 12M6 6l12 12';
const STEP_MS = 650;

const SVG = 'http://www.w3.org/2000/svg';
export const fetchingIcon = document.createElementNS(SVG, 'svg');
fetchingIcon.setAttribute('class', 'fetching');
fetchingIcon.setAttribute('viewBox', '0 0 24 24');
fetchingIcon.setAttribute('role', 'img');
const path = fetchingIcon.appendChild(document.createElementNS(SVG, 'path'));
const morph = createMorph(path, CHECK, { reducedMotion: 'user' });

let step: ReturnType<typeof setInterval> | undefined;
let ball = 0;

function show(state: 'fetching' | 'fetched' | 'failed') {
  fetchingIcon.dataset.state = state;
  fetchingIcon.setAttribute('aria-label', state);
}
show('fetched');

export function fetchStarted() {
  if (step) return;
  show('fetching');
  const next = () => { morph.morphTo(BALLS[ball]!); ball = (ball + 1) % BALLS.length; };
  next();
  step = setInterval(next, STEP_MS);
}

export function fetchEnded(ok: boolean) {
  clearInterval(step);
  step = undefined;
  show(ok ? 'fetched' : 'failed');
  morph.morphTo(ok ? CHECK : X);
}
