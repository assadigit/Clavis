/**
 * CLAVIS — dotenv rules tests (SPEC §5.2, §4.2), mirroring the Go suite in
 * internal/exchange. One documented algorithm, both sides tested.
 */
import { describe, expect, it } from "vitest";
import {
  autoKey,
  dedupeKeys,
  formatDotenvLine,
  looksLikeDotenv,
  needsDotenvQuoting,
  parseDotenvLine,
  parseDotenvValue,
} from "./dotenv";

describe("quoting", () => {
  it("quotes values with newline, quote, backslash or edge whitespace", () => {
    expect(needsDotenvQuoting("plain")).toBe(false);
    expect(needsDotenvQuoting("")).toBe(false);
    expect(needsDotenvQuoting('has "quotes"')).toBe(true);
    expect(needsDotenvQuoting("back\\slash")).toBe(true);
    expect(needsDotenvQuoting("line\nbreak")).toBe(true);
    expect(needsDotenvQuoting(" padded ")).toBe(true);
    expect(needsDotenvQuoting("tab\tinside")).toBe(false); // tabs pass through raw
  });

  it("round-trips hostile values through format/parse", () => {
    const hostile = [
      'quoted "and" \\\\ backslash',
      "multi\nline",
      " leading",
      "plain",
      "",
    ];
    for (const v of hostile) {
      const line = formatDotenvLine("KEY", v);
      expect(line.startsWith("KEY=")).toBe(true);
      expect(parseDotenvLine(line)?.value).toBe(v);
    }
  });

  it("tolerates a trailing CR (CRLF file lines)", () => {
    expect(parseDotenvLine("KEY=value\r")?.value).toBe("value");
  });
});

describe("looksLikeDotenv", () => {
  it("true when every non-blank line is KEY=value", () => {
    expect(looksLikeDotenv("A=1\n\nB=2")).toBe(true);
    expect(looksLikeDotenv("A=1\nnot a pair")).toBe(false);
    expect(looksLikeDotenv("")).toBe(false);
  });
});

describe("dedupeKeys", () => {
  it("suffixes duplicates with _2, _3… and empties become KEY", () => {
    expect(dedupeKeys(["A", "A", "A"])).toEqual(["A", "A_2", "A_3"]);
    expect(dedupeKeys(["", "", ""])).toEqual(["KEY", "KEY_2", "KEY_3"]);
  });

  it("probes past existing _N suffixes (collision bug fix)", () => {
    expect(dedupeKeys(["A", "A_2", "A"])).toEqual(["A", "A_2", "A_3"]);
    expect(dedupeKeys(["KEY", "", "KEY", "", "KEY"])).toEqual([
      "KEY", "KEY_2", "KEY_3", "KEY_4", "KEY_5",
    ]);
  });
});

describe("autoKey", () => {
  it("builds UPPER_SNAKE keys from names", () => {
    expect(autoKey("GitHub token")).toBe("GITHUB_TOKEN");
    expect(autoKey("  spaced  --  name ")).toBe("SPACED_NAME");
    expect(autoKey("!!!")).toBe("KEY"); // nothing survives → KEY
    expect(autoKey("databáze 2")).toBe("DATAB_ZE_2"); // non-ASCII → separator
  });
});
