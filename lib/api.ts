import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./rbac";

export function jsonOk(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonError(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Converts thrown errors into a consistent JSON response. */
export function handleApiError(error: unknown) {
  if (error instanceof HttpError) {
    return jsonError(error.status, error.message);
  }
  if (error instanceof ZodError) {
    return jsonError(422, "Validasi gagal", {
      issues: error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  console.error("[API ERROR]", error);
  return jsonError(500, "Terjadi kesalahan pada server");
}
