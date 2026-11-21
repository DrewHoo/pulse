// Its own module so the page can print the thresholds without the worker's code.

/** A quick exit is a measured visit under this many seconds, on one page, with no tap. */
export const QUICK_SECONDS = 10;
/** A visit stayed when it saw a second page, or was this long in view, or had this many taps. */
export const STAYED_SECONDS = 60;
export const STAYED_TAPS = 3;
