import path from "node:path";

// Bank transfer proof can contain account numbers and other sensitive
// details, so it's stored the same way as machine capture evidence
// (see lib/machine-captures.ts): a private directory outside `public/`,
// served only through an authenticated route, never a direct static URL.
const configuredProofDir = process.env.REDEMPTION_PROOF_STORAGE_DIR;

export const proofStorageRoot = configuredProofDir
  ? path.resolve(/*turbopackIgnore: true*/ configuredProofDir)
  : path.resolve("data", "private", "redemption-proofs");

export function resolveProofPath(relativePath: string) {
  const resolved = path.resolve(proofStorageRoot, relativePath);
  if (
    resolved !== proofStorageRoot &&
    !resolved.startsWith(`${proofStorageRoot}${path.sep}`)
  ) {
    throw new Error("Path bukti transfer tidak valid");
  }
  return resolved;
}

export const PROOF_ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const PROOF_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function hasValidImageSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return (
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    );
  }
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}
