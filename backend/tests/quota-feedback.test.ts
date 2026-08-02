import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AnonymousQuotaExceededError,
  NotesDataStore,
} from "../../server/auth.js";

test("匿名图片额度按北京时间零点以 500 张全局重置", async (context) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-quota-data-"));
  const store = new NotesDataStore(dataDir);

  context.after(async () => {
    await rm(dataDir, { force: true, recursive: true });
  });

  const beforeMidnight = new Date("2026-07-29T15:59:59.000Z");
  const firstReservation = await store.reserveAnonymousUploads(
    499,
    500,
    beforeMidnight,
  );
  assert.equal(firstReservation.dateKey, "2026-07-29");
  assert.equal(firstReservation.used, 499);
  assert.equal(firstReservation.remaining, 1);
  assert.equal(firstReservation.resetsAt, "2026-07-29T16:00:00.000Z");

  const finalReservation = await store.reserveAnonymousUploads(
    1,
    500,
    beforeMidnight,
  );
  assert.equal(finalReservation.used, 500);
  assert.equal(finalReservation.remaining, 0);

  await assert.rejects(
    () => store.reserveAnonymousUploads(1, 500, beforeMidnight),
    (error: unknown) => {
      assert.ok(error instanceof AnonymousQuotaExceededError);
      assert.equal(error.quota.used, 500);
      assert.match(error.message, /zhaoolee@gmail\.com/);
      return true;
    },
  );

  const afterMidnight = await store.reserveAnonymousUploads(
    1,
    500,
    new Date("2026-07-29T16:00:00.000Z"),
  );
  assert.equal(afterMidnight.dateKey, "2026-07-30");
  assert.equal(afterMidnight.used, 1);
  assert.equal(afterMidnight.remaining, 499);
});
