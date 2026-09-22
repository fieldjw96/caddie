import { findLeaks, redact, secretsFrom } from "./redact";

// A made-up credential for a host that does not exist.
const URL_WITH_PASSWORD =
  "postgres://caddie_ingest:s3cr%21t-pass@db.example.invalid:5432/caddie";

describe("secretsFrom", () => {
  it("hides the whole value and its password, as written and decoded", () => {
    expect(secretsFrom(URL_WITH_PASSWORD)).toEqual([
      URL_WITH_PASSWORD,
      "s3cr%21t-pass",
      "s3cr!t-pass",
    ]);
  });

  it("is empty when there is nothing to hide", () => {
    expect(secretsFrom(undefined)).toEqual([]);
    expect(secretsFrom("")).toEqual([]);
  });

  it("still hides a value that is not a URL", () => {
    expect(secretsFrom("host=db user=u password=p")).toEqual(["host=db user=u password=p"]);
  });
});

describe("redact", () => {
  const secrets = secretsFrom(URL_WITH_PASSWORD);

  it("masks the literal connection string", () => {
    expect(redact(`connecting to ${URL_WITH_PASSWORD}`, secrets)).toBe("connecting to ***");
  });

  it("masks the decoded password on its own, as a driver error might print it", () => {
    expect(redact('password authentication failed: "s3cr!t-pass"', secrets)).toBe(
      'password authentication failed: "***"',
    );
  });

  it("masks credentials in any URI, even one it was not told about", () => {
    expect(redact("at mysql://root:hunter2@other.invalid/db")).toBe(
      "at mysql://***:***@other.invalid/db",
    );
  });

  it("masks a password= pair, whatever its case", () => {
    expect(redact("host=db PASSWORD=hunter2 user=u")).toBe("host=db PASSWORD=*** user=u");
    expect(redact("?sslmode=require&password=hunter2&x=1")).toBe(
      "?sslmode=require&password=***&x=1",
    );
  });

  it("leaves an ordinary line alone", () => {
    const line = "Matched (28): Augusta National Golf Club -> https://api.opengolfapi.org/x";
    expect(redact(line, secrets)).toBe(line);
  });
});

describe("findLeaks", () => {
  const secrets = secretsFrom(URL_WITH_PASSWORD);

  it("finds nothing in redacted output", () => {
    const logged = redact(`${URL_WITH_PASSWORD}\npassword=x\nhttps://u:p@h.invalid`, secrets);
    expect(findLeaks(logged, secrets)).toEqual([]);
  });

  it("finds the connection string or its password verbatim", () => {
    expect(findLeaks(`oops s3cr!t-pass`, secrets)).toHaveLength(1);
  });

  it("finds a URI with credentials without repeating them", () => {
    const leaks = findLeaks("https://someone:hunter2@h.invalid");
    expect(leaks).toEqual(["a URI with credentials, scheme https://"]);
    expect(leaks.join()).not.toContain("hunter2");
  });

  it("finds a password= pair", () => {
    expect(findLeaks("password=hunter2")).toEqual(["a password= pair"]);
  });
});
