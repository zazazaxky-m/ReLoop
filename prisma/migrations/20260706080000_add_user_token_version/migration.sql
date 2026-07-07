-- Invalidate stateless JWT sessions on password reset, role change, etc.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
