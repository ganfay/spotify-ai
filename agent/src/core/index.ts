// The only code of this project that runs every time Spotify starts (besides the
// ad blocker). It must cost nothing when no look is saved: one read of local
// storage, then it is done. Decision 30.

import { applyAppearance, loadAppearance } from "./appearance";

(() => {
  const look = loadAppearance();
  if (look) applyAppearance(look);
  // The Appearance page uses this for a live preview.
  (window as unknown as { __spotifyAiAppearance?: typeof applyAppearance }).__spotifyAiAppearance = applyAppearance;
})();
