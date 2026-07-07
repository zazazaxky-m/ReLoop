import path from "node:path";

const configuredMachineMediaDir = process.env.MACHINE_MEDIA_STORAGE_DIR;

export const machineMediaStorageRoot = configuredMachineMediaDir
  ? path.resolve(/*turbopackIgnore: true*/ configuredMachineMediaDir)
  : path.resolve("data", "private", "machine-media");

export function resolveMachineMediaPath(relativePath: string) {
  const resolved = path.resolve(machineMediaStorageRoot, relativePath);
  if (
    resolved !== machineMediaStorageRoot &&
    !resolved.startsWith(`${machineMediaStorageRoot}${path.sep}`)
  ) {
    throw new Error("Path media mesin tidak valid");
  }
  return resolved;
}

export function serializeMachineMedia(media: {
  id: string; title: string | null; mediaType: string; mimeType: string;
  originalName: string; fileSize: number; sha256: string; durationSeconds: number;
  sortOrder: number; active: boolean; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: media.id, title: media.title, mediaType: media.mediaType, mimeType: media.mimeType,
    originalName: media.originalName, fileSize: media.fileSize, sha256: media.sha256,
    durationSeconds: media.durationSeconds, sortOrder: media.sortOrder, active: media.active,
    createdAt: media.createdAt, updatedAt: media.updatedAt,
    previewUrl: `/api/machine-media/${media.id}/content`,
  };
}
