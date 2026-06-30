ALTER TYPE "TravelAgentOrgStatus" RENAME TO "TravelAgentOrgStatus_old";
CREATE TYPE "TravelAgentOrgStatus" AS ENUM ('PENDING', 'INVITED');
ALTER TABLE "TravelAgentOrganization"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TravelAgentOrgStatus"
  USING (
    CASE
      WHEN "status"::text IN ('INVITED', 'ACTIVE') THEN 'INVITED'::"TravelAgentOrgStatus"
      ELSE 'PENDING'::"TravelAgentOrgStatus"
    END
  ),
  ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "TravelAgentOrgStatus_old";

ALTER TYPE "TravelAgentInviteStatus" RENAME TO "TravelAgentInviteStatus_old";
CREATE TYPE "TravelAgentInviteStatus" AS ENUM ('PENDING', 'INVITED');
ALTER TABLE "TravelAgentInvite"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TravelAgentInviteStatus"
  USING (
    CASE
      WHEN "status"::text IN ('ACCEPTED', 'INVITED') THEN 'INVITED'::"TravelAgentInviteStatus"
      ELSE 'PENDING'::"TravelAgentInviteStatus"
    END
  ),
  ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "TravelAgentInviteStatus_old";

DROP INDEX IF EXISTS "TravelAgentInvite_token_key";
ALTER TABLE "TravelAgentInvite" DROP COLUMN IF EXISTS "token";
ALTER TABLE "TravelAgentInvite" DROP COLUMN IF EXISTS "acceptedById";
ALTER TABLE "TravelAgentInvite" DROP COLUMN IF EXISTS "expiresAt";
ALTER TABLE "TravelAgentInvite" DROP COLUMN IF EXISTS "acceptedAt";
