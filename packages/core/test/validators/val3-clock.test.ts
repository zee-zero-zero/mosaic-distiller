// VAL-3: no validator reads the clock. Every example of §3 is run through its validators with the
// system time set to 1990, to the real date and to 2090; the answers must be identical.
import { afterEach, describe, expect, it, vi } from "vitest";
import { VALIDATORS } from "../../src/validators";
import { allAnswers } from "./fixtures";

describe("VAL-3 no validator reads the clock", () => {
  afterEach(() => vi.useRealTimers());

  it("VAL-3 clock: identical answers at 1990, today and 2090", () => {
    const today = new Date();
    const answers: string[][] = [];
    for (const when of [
      new Date("1990-01-01T00:00:00Z"),
      today,
      new Date("2090-01-01T00:00:00Z"),
    ]) {
      vi.useFakeTimers();
      vi.setSystemTime(when);
      answers.push(allAnswers());
      vi.useRealTimers();
    }
    expect(answers[0]!.length).toBeGreaterThan(150);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it("VAL-3 clock: two-digit-year identifiers keep the same answer across the century boundary", () => {
    // 710319/2745 is born in 1971 or 2071 depending on a clock; the validator tries every century.
    // A Swedish 10-digit number is valid in some century whatever the date.
    const before: boolean[] = [];
    for (const when of ["1990-06-01T00:00:00Z", "2090-06-01T00:00:00Z"]) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(when));
      before.push(
        VALIDATORS.cz_rc!("710319/2745").ok,
        VALIDATORS.se_pnr!("880320-0016").ok,
        VALIDATORS.it_cf!("RCCMNL83S18D969H").ok,
        VALIDATORS.no_fnr!("151086 95088").ok,
        VALIDATORS.za_id!("7503305044089").ok,
      );
      vi.useRealTimers();
    }
    expect(before.slice(0, 5)).toEqual(before.slice(5));
    expect(before.every(Boolean)).toBe(true);
  });
});
