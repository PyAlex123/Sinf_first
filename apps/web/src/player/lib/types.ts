/** What the "Well done!" dialog shows after a screen is solved. */
export interface WinInfo {
  stars: number;
  /** PICS key of a picture to show. */
  picKey?: string;
  message?: string;
}
