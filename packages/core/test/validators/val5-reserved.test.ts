// VAL-5 at the validator level: values reserved for documentation or fiction (§2.4.6) are never
// accepted, at the edges of every range, and the neighbours just outside are accepted where the
// shape is valid. (Through the engine and the pack the same cases are run as conformance cases.)
import { describe, expect, it } from "vitest";
import { VALIDATORS } from "../../src/validators";

const ok = (name: string, text: string): boolean =>
  (VALIDATORS[name] as (s: string) => { ok: boolean })(text).ok;

describe("VAL-5 reserved values are never hits", () => {
  it("VAL-5 telephone numbers 555-0100 to 555-0199", () => {
    for (const n of [
      "(202) 555-0100",
      "(202) 555-0150",
      "(202) 555-0199",
      "202-555-0100",
      "+1 202 555 0199",
    ]) {
      expect(ok("nanp_rules", n), n).toBe(false);
    }
    for (const n of ["(202) 555-0099", "(202) 555-0200", "202-555-0200", "202-554-0150"]) {
      expect(ok("nanp_rules", n), n).toBe(true);
    }
  });
  it("VAL-5 IPv4 documentation ranges and 0.0.0.0/8", () => {
    for (const n of [
      "192.0.2.0",
      "192.0.2.1",
      "192.0.2.255",
      "198.51.100.0",
      "198.51.100.255",
      "203.0.113.0",
      "203.0.113.255",
      "0.0.0.0",
      "0.255.255.255",
    ]) {
      expect(ok("ipv4_scope", n), n).toBe(false);
    }
    for (const n of [
      "192.0.3.1",
      "192.0.1.255",
      "198.51.101.1",
      "198.51.99.255",
      "203.0.114.1",
      "203.0.112.255",
      "1.0.0.0",
    ]) {
      expect(ok("ipv4_scope", n), n).toBe(true);
    }
  });
  it("VAL-5 IPv6 2001:db8::/32", () => {
    for (const n of [
      "2001:db8::1:2",
      "2001:0db8:0:0:0:0:0:1",
      "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
      "2001:DB8::a:b:c",
    ]) {
      expect(ok("ipv6_parse", n), n).toBe(false);
    }
    for (const n of ["2001:db9::1:2", "2001:db7::1:2", "2002:db8::1:2", "2001:1::db8:2"]) {
      expect(ok("ipv6_parse", n), n).toBe(true);
    }
  });
  it("VAL-5 reserved e-mail domains and top-level domains", () => {
    for (const n of [
      "user@example.com",
      "user@sub.example.org",
      "user@EXAMPLE.NET",
      "u@a.b.example.com",
      "u@host.example",
      "u@host.invalid",
      "u@host.test",
      "u@host.localhost",
    ]) {
      expect(ok("email_shape", n), n).toBe(false);
    }
    for (const n of [
      "user@examples.com",
      "user@myexample.org",
      "user@example.co",
      "user@testing.com",
      "user@host.exampled",
    ]) {
      expect(ok("email_shape", n), n).toBe(true);
    }
  });
  it("VAL-5 MAC addresses 00:00:5e:00:53:00 to 00:00:5e:00:53:ff", () => {
    for (const n of ["00:00:5e:00:53:00", "00:00:5E:00:53:ff", "00-00-5e-00-53-7a"]) {
      expect(ok("mac_not_reserved", n), n).toBe(false);
    }
    for (const n of ["00:00:5e:00:52:ff", "00:00:5e:00:54:00", "00:00:5f:00:53:00"]) {
      expect(ok("mac_not_reserved", n), n).toBe(true);
    }
  });
});
