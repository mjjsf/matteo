/** Year formatting, shared by every place a book's byline appears.
 *
 *  Negative years are BCE. The corpus contains ancient texts, and `-380` shown
 *  raw reads as a bug rather than as Plato. */
export function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : String(year);
}
