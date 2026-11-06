import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterPhotos, parseTags, photoPath, tagCounts, uploadProblem, type Photo } from "../../lib/content/photo-library";

const photo = (over: Partial<Photo>): Photo => ({
  id: "1",
  path: "p",
  fileName: null,
  contentType: "image/jpeg",
  sizeBytes: 1,
  width: null,
  height: null,
  caption: null,
  tags: [],
  takenAt: null,
  usedAt: null,
  postUrl: null,
  createdAt: "2026-11-01T00:00:00Z",
  ...over,
});

describe("photo library", () => {
  it("parses tags: lowercase, trimmed, deduped, # and commas", () => {
    assert.deepEqual(parseTags(" Stage, #Event ,stage\n  office  desk "), ["stage", "event", "office desk"]);
    assert.deepEqual(parseTags(""), []);
  });

  it("filters by used status and tag, and orders", () => {
    const a = photo({ id: "a", tags: ["stage"], createdAt: "2026-11-01T00:00:00Z", takenAt: "2026-01-01T00:00:00Z" });
    const b = photo({ id: "b", usedAt: "2026-11-03T00:00:00Z", createdAt: "2026-11-02T00:00:00Z", takenAt: "2026-06-01T00:00:00Z" });
    const c = photo({ id: "c", tags: ["stage", "office"], createdAt: "2026-10-01T00:00:00Z", takenAt: "2026-09-01T00:00:00Z" });
    const ids = (ps: Photo[]) => ps.map((p) => p.id);
    assert.deepEqual(ids(filterPhotos([a, b, c], { status: "all", tag: "all", order: "newest" })), ["b", "a", "c"]);
    assert.deepEqual(ids(filterPhotos([a, b, c], { status: "all", tag: "all", order: "taken" })), ["c", "b", "a"]);
    assert.deepEqual(ids(filterPhotos([a, b, c], { status: "unused", tag: "all", order: "newest" })), ["a", "c"]);
    assert.deepEqual(ids(filterPhotos([a, b, c], { status: "used", tag: "all", order: "newest" })), ["b"]);
    assert.deepEqual(ids(filterPhotos([a, b, c], { status: "all", tag: "office", order: "newest" })), ["c"]);
    assert.deepEqual(tagCounts([a, b, c]), [
      { tag: "stage", count: 2 },
      { tag: "office", count: 1 },
    ]);
  });

  it("checks uploads", () => {
    assert.equal(uploadProblem({ name: "a.jpg", type: "image/jpeg", size: 10 }), null);
    assert.match(uploadProblem({ name: "a.pdf", type: "application/pdf", size: 10 })!, /isn't a JPEG/);
    assert.match(uploadProblem({ name: "a.jpg", type: "image/jpeg", size: 60 * 1024 * 1024 })!, /over 50 MB/);
  });

  it("builds readable storage paths", () => {
    const now = new Date("2026-11-06T10:00:00Z");
    assert.equal(photoPath("IMG 0042 (Stage).JPG", "uuid", now), "2026/11/uuid-img-0042-stage.jpg");
    assert.equal(photoPath("..", "uuid", now), "2026/11/uuid");
  });
});
