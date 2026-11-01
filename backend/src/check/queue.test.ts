import { describe, expect, it } from "vitest";
import { CheckQueue, type CheckJob } from "./queue.js";

const job = (headSha: string, prNumber = 12): CheckJob => ({
  owner: "o",
  repo: "r",
  prNumber,
  headSha,
  issueNumber: 7,
});

describe("CheckQueue", () => {
  it("queues a job and runs it", async () => {
    const ran: CheckJob[] = [];
    const q = new CheckQueue(async (j) => void ran.push(j));
    expect(q.enqueue("d1", job("sha1"))).toBe("queued");
    await q.idle();
    expect(ran).toHaveLength(1);
  });

  it("dedupes the same delivery id", async () => {
    const ran: CheckJob[] = [];
    const q = new CheckQueue(async (j) => void ran.push(j));
    q.enqueue("d1", job("sha1"));
    expect(q.enqueue("d1", job("sha1"))).toBe("duplicate");
    await q.idle();
    expect(ran).toHaveLength(1);
  });

  it("dedupes the same head on a different delivery", async () => {
    const ran: CheckJob[] = [];
    const q = new CheckQueue(async (j) => void ran.push(j));
    q.enqueue("d1", job("sha1"));
    expect(q.enqueue("d2", job("sha1"))).toBe("duplicate");
    await q.idle();
    expect(ran).toHaveLength(1);
  });

  it("runs one check at a time, in order", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = new CheckQueue(async (j) => {
      order.push(`start-${j.headSha}`);
      if (j.headSha === "sha1") await gate;
      order.push(`end-${j.headSha}`);
    });
    q.enqueue("d1", job("sha1"));
    q.enqueue("d2", job("sha2"));
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["start-sha1"]);
    release();
    await q.idle();
    expect(order).toEqual(["start-sha1", "end-sha1", "start-sha2", "end-sha2"]);
  });

  it("marks the older run stale when a newer head arrives", () => {
    const q = new CheckQueue(async () => {});
    const oldJob = job("sha1");
    q.enqueue("d1", oldJob);
    q.enqueue("d2", job("sha2"));
    expect(q.isStale(oldJob)).toBe(true);
    expect(q.isStale(job("sha2"))).toBe(false);
  });

  it("a failing run does not block the next job", async () => {
    const ran: string[] = [];
    const q = new CheckQueue(async (j) => {
      if (j.headSha === "sha1") throw new Error("boom");
      ran.push(j.headSha);
    });
    q.enqueue("d1", job("sha1"));
    q.enqueue("d2", job("sha2"));
    await q.idle();
    expect(ran).toEqual(["sha2"]);
  });
});
