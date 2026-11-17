// Plain data types the rest of the agent works with.
// Nothing outside src/spotify/ knows about Spicetify's own shapes.

export interface Playlist {
  uri: string;
  name: string;
  description: string;
  ownerName: string;
  /** True when the user can add and remove tracks. */
  editable: boolean;
  trackCount: number;
  /** https URL of the cover, or "" when there is none. */
  imageUrl: string;
}

export interface Track {
  uri: string;
  /** Identifies one entry of one playlist. Two copies of a song have different uids. */
  uid: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  /** ISO date string; empty for Liked Songs entries without it. */
  addedAt: string;
  explicit: boolean;
  playable: boolean;
  local: boolean;
  /** Small cover image (https), or "". */
  imageUrl: string;
}

/** Points at one entry of a playlist. */
export interface EntryRef {
  uri: string;
  uid: string;
}

export type Position = "start" | "end" | { before: EntryRef } | { after: EntryRef };

export class SpotifyApiError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SpotifyApiError";
  }
}
