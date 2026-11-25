/**
 * CLAVIS — shared shape of the bundled emoji dataset (v1.15.0, DECISIONS
 * §57). Mirrors the ambient declaration in src/emoji-data.d.ts.
 */
export interface EmojiEntry {
  emoji: string;
  name: string;
  slug: string;
  skin_tone_support?: boolean;
}

export interface EmojiGroup {
  name: string;
  slug: string;
  emojis: EmojiEntry[];
}
