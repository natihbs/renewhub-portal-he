import { describe, it, expect } from "vitest";
import {
  shouldNotifyPace, notificationSourcesReady, notReadySources,
  notificationEvaluationKey, shouldEvaluateNotifications, deliveryFailed,
  MAX_NOTIFICATION_ATTEMPTS, type NotificationSources,
} from "@/lib/morning-notifications";

const ready: NotificationSources = {
  representatives: "ready", kpiValues: "ready", goals: "ready",
  feedback: "ready", schedules: "ready", underwriting: "ready", competitions: "ready",
};

describe("pace notification", () => {
  it("does not fire early in the month for strong progress", () => {
    // day 2 of 22: 12% of the monthly target is well ahead of the 9% expected
    expect(shouldNotifyPace({ actual: 12, target: 100, workdaysTotal: 22, workdaysPassed: 2 })).toBe(false);
  });

  it("does not fire before any workday has elapsed (raw, unclamped)", () => {
    expect(shouldNotifyPace({ actual: 0, target: 100, workdaysTotal: 22, workdaysPassed: 0 })).toBe(false);
  });

  it("does not fire with a null or zero target", () => {
    expect(shouldNotifyPace({ actual: 0, target: null, workdaysTotal: 22, workdaysPassed: 10 })).toBe(false);
    expect(shouldNotifyPace({ actual: 0, target: 0, workdaysTotal: 22, workdaysPassed: 10 })).toBe(false);
  });

  it("fires late in the month when clearly behind the workday pace", () => {
    expect(shouldNotifyPace({ actual: 40, target: 100, workdaysTotal: 22, workdaysPassed: 20 })).toBe(true);
  });

  it("does not fire late in the month when on pace", () => {
    expect(shouldNotifyPace({ actual: 92, target: 100, workdaysTotal: 22, workdaysPassed: 20 })).toBe(false);
  });
});

describe("readiness", () => {
  it("blocks while any source is loading or failed", () => {
    expect(notificationSourcesReady(ready)).toBe(true);
    expect(notificationSourcesReady({ ...ready, competitions: "loading" })).toBe(false);
    expect(notificationSourcesReady({ ...ready, goals: "error" })).toBe(false);
    expect(notReadySources({ ...ready, kpiValues: "error", schedules: "loading" }))
      .toEqual(["kpiValues", "schedules"]);
  });
});

describe("evaluation key + gate", () => {
  const key = (over: Partial<Parameters<typeof notificationEvaluationKey>[0]> = {}) =>
    notificationEvaluationKey({ userId: "u1", teamId: "t1", businessDate: "2026-09-05", signature: ["a"], ...over });

  it("is null without an identity or team", () => {
    expect(key({ userId: null })).toBeNull();
    expect(key({ teamId: null })).toBeNull();
  });

  it("changes on team switch, day rollover and data change", () => {
    expect(key({ teamId: "t2" })).not.toBe(key());
    expect(key({ businessDate: "2026-09-06" })).not.toBe(key());
    expect(key({ signature: ["b"] })).not.toBe(key());
    expect(key()).toBe(key());
  });

  it("does not re-deliver the same key, but re-evaluates a new one", () => {
    const k = key()!;
    const base = { ready: true, key: k, deliveredKey: null, failedKey: null, failedAttempts: 0, inFlight: false };
    expect(shouldEvaluateNotifications(base)).toBe(true);
    expect(shouldEvaluateNotifications({ ...base, deliveredKey: k })).toBe(false);
    expect(shouldEvaluateNotifications({ ...base, deliveredKey: "other" })).toBe(true);
  });

  it("never evaluates while not ready or in flight", () => {
    const k = key()!;
    expect(shouldEvaluateNotifications({ ready: false, key: k, deliveredKey: null, failedKey: null, failedAttempts: 0, inFlight: false })).toBe(false);
    expect(shouldEvaluateNotifications({ ready: true, key: k, deliveredKey: null, failedKey: null, failedAttempts: 0, inFlight: true })).toBe(false);
  });

  it("retries a failed delivery up to a bounded number of attempts", () => {
    const k = key()!;
    const s = (attempts: number) => shouldEvaluateNotifications({
      ready: true, key: k, deliveredKey: null, failedKey: k, failedAttempts: attempts, inFlight: false,
    });
    expect(s(1)).toBe(true);
    expect(s(MAX_NOTIFICATION_ATTEMPTS - 1)).toBe(true);
    expect(s(MAX_NOTIFICATION_ATTEMPTS)).toBe(false);
  });
});

describe("delivery outcome", () => {
  it("treats dedupe skips as success and server failures as retryable", () => {
    expect(deliveryFailed({ delivered: 0, skipped: 3, failed: 0 })).toBe(false);
    expect(deliveryFailed({ delivered: 2, skipped: 0, failed: 0 })).toBe(false);
    expect(deliveryFailed({ delivered: 1, skipped: 1, failed: 1 })).toBe(true);
    expect(deliveryFailed(null)).toBe(true);
  });
});
