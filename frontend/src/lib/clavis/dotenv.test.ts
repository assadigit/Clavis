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
  parseCredentialBlock,
  parseCredentialLine,
  parseDotenvLine,
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

/* ------------- tolerant paste parsing (v1.6.0, DECISIONS §45) ------------- */

describe("parseCredentialLine (tolerant)", () => {
  it("parses classic KEY=value", () => {
    expect(parseCredentialLine("DATABASE_URL=postgres://db")).toEqual({
      name: "DATABASE_URL",
      key: "DATABASE_URL",
      value: "postgres://db",
    });
  });

  it("parses spaced KEY = value", () => {
    expect(parseCredentialLine("KEY = value")).toEqual({
      name: "KEY",
      key: "KEY",
      value: "value",
    });
  });

  it("turns 'Name: value' into name + autoKey, keeping var-name keys", () => {
    expect(parseCredentialLine("GitHub token: ghp_123")).toEqual({
      name: "GitHub token",
      key: "GITHUB_TOKEN",
      value: "ghp_123",
    });
    expect(parseCredentialLine("DATABASE_URL: postgres://db")).toEqual({
      name: "DATABASE_URL",
      key: "DATABASE_URL",
      value: "postgres://db",
    });
  });

  it("strips markdown bullets and numbered lists", () => {
    expect(parseCredentialLine("- API_KEY=secret")).toEqual({
      name: "API_KEY",
      key: "API_KEY",
      value: "secret",
    });
    expect(parseCredentialLine("* GitHub token: ghp_x")).toEqual({
      name: "GitHub token",
      key: "GITHUB_TOKEN",
      value: "ghp_x",
    });
    expect(parseCredentialLine("3. PORT=8080")?.key).toBe("PORT");
    expect(parseCredentialLine("1) HOST=localhost")?.key).toBe("HOST");
  });

  it("unquotes dotenv-quoted values", () => {
    expect(parseCredentialLine('TOKEN="abc def"')?.value).toBe("abc def");
  });

  it("rejects prose, comments, URLs and empty sides", () => {
    expect(parseCredentialLine("# comment")).toBeNull();
    expect(parseCredentialLine("just prose")).toBeNull();
    expect(parseCredentialLine("My credentials:")).toBeNull(); // empty colon value
    expect(parseCredentialLine("https://api.example.com")).toBeNull(); // scheme, not separator
    expect(parseCredentialLine("=value")).toBeNull();
    expect(parseCredentialLine("   ")).toBeNull();
  });
});

describe("parseCredentialBlock (the empty-group bug fix)", () => {
  it("finds credentials in every common paste style", () => {
    const { creds, bad } = parseCredentialBlock(
      "# project\n" +
        "\n" +
        "DATABASE_URL=postgres://localhost/app\n" +
        "GitHub token: ghp_abc123\n" +
        "- STRIPE_KEY = sk_test_456\n" +
        "not a credential line\n" +
        "GitHub token: ghp_dup\n",
    );
    expect(bad).toBe(1);
    expect(creds.map((c) => c.key)).toEqual([
      "DATABASE_URL",
      "GITHUB_TOKEN",
      "STRIPE_KEY",
      "GITHUB_TOKEN_2", // deduped like group copies
    ]);
  });

  it("never returns zero credentials for a real credentials paste", () => {
    // The user-reported bug: colon-style pastes parsed to ZERO items and the
    // group was created empty, silently discarding the pasted text.
    const { creds } = parseCredentialBlock(
      "GitHub token: ghp_abc\nOpenAI key: sk-xyz",
    );
    expect(creds.length).toBe(2);
  });
});
