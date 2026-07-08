import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveMachineMediaPath, serializeMachineMedia } from "./machine-media";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("resolveMachineMediaPath", () => {
  it("resolves a relative path within storage root", () => {
    const result = resolveMachineMediaPath("images/photo.jpg");
    expect(result).toContain("machine-media");
    expect(result).toContain("images");
    expect(result).toContain("photo.jpg");
  });

  it("throws on path traversal", () => {
    expect(() => resolveMachineMediaPath("../etc/passwd")).toThrow();
  });

  it("throws on absolute path escape", () => {
    expect(() => resolveMachineMediaPath("/etc/passwd")).toThrow();
  });
});

describe("serializeMachineMedia", () => {
  const dummyDate = new Date("2025-01-01T00:00:00Z");

  it("serializes a media record with previewUrl", () => {
    const result = serializeMachineMedia({
      id: "media_1",
      title: "Foto Mesin",
      mediaType: "IMAGE",
      mimeType: "image/jpeg",
      originalName: "photo.jpg",
      fileSize: 102400,
      sha256: "abc123",
      durationSeconds: 0,
      sortOrder: 1,
      active: true,
      createdAt: dummyDate,
      updatedAt: dummyDate,
    });

    expect(result).toEqual({
      id: "media_1",
      title: "Foto Mesin",
      mediaType: "IMAGE",
      mimeType: "image/jpeg",
      originalName: "photo.jpg",
      fileSize: 102400,
      sha256: "abc123",
      durationSeconds: 0,
      sortOrder: 1,
      active: true,
      createdAt: dummyDate,
      updatedAt: dummyDate,
      previewUrl: "/api/machine-media/media_1/content",
    });
  });

  it("handles null title", () => {
    const result = serializeMachineMedia({
      id: "media_2",
      title: null,
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      originalName: "video.mp4",
      fileSize: 999,
      sha256: "def456",
      durationSeconds: 30,
      sortOrder: 0,
      active: false,
      createdAt: dummyDate,
      updatedAt: dummyDate,
    });

    expect(result.title).toBeNull();
    expect(result.previewUrl).toBe("/api/machine-media/media_2/content");
  });
});
