import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Password minimal ${PASSWORD_MIN_LENGTH} karakter`,
  );
