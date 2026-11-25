/**
 * CLAVIS — module shape for the bundled emoji dataset (v1.15.0, DECISIONS
 * §57). The package ships plain JSON without types for its subpaths; this
 * ambient declaration keeps tsc fast (no inference over the 1,914-emoji
 * file) and pins the picker's view of the data.
 */
declare module "unicode-emoji-json/data-by-group.json" {
  interface EmojiEntry {
    emoji: string;
    name: string;
    slug: string;
    skin_tone_support?: boolean;
  }
  interface EmojiGroup {
    name: string;
    slug: string;
    emojis: EmojiEntry[];
  }
  const data: EmojiGroup[];
  export default data;
}
