CREATE TYPE "CampaignRewardMode" AS ENUM ('MONEY_REWARD', 'COMPLIANCE_ONLY');
CREATE TYPE "TravelAgentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE "TravelAgentOrgStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');
CREATE TYPE "TravelAgentInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
CREATE TYPE "TravelAgentUserRole" AS ENUM ('OWNER', 'STAFF', 'TOUR_LEADER');
CREATE TYPE "ValidationStage" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'BANK_SAMPAH_PICKUP');
CREATE TYPE "GateType" AS ENUM ('ENTRY', 'EXIT', 'BANK_SAMPAH');
CREATE TYPE "ComplianceStatus" AS ENUM ('NOT_STARTED', 'CHECKED_IN', 'COMPLIANT', 'NEEDS_REVIEW', 'NON_COMPLIANT');

ALTER TABLE "Campaign" ADD COLUMN "rewardMode" "CampaignRewardMode" NOT NULL DEFAULT 'MONEY_REWARD';

CREATE TABLE "TravelAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "contactPerson" TEXT,
    "status" "TravelAgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TravelAgentOrganization" (
    "id" TEXT NOT NULL,
    "travelAgentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "TravelAgentOrgStatus" NOT NULL DEFAULT 'INVITED',
    "invitedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelAgentOrganization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TravelAgentInvite" (
    "id" TEXT NOT NULL,
    "travelAgentId" TEXT,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "TravelAgentInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT,
    "acceptedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelAgentInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TravelAgentUser" (
    "id" TEXT NOT NULL,
    "travelAgentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleInAgent" "TravelAgentUserRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelAgentUser_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Trip" ADD COLUMN "travelAgentId" TEXT;
ALTER TABLE "Trip" ADD COLUMN "complianceStatus" "ComplianceStatus" NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE "Trip" ADD COLUMN "complianceScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Trip" ADD COLUMN "checkInAt" TIMESTAMP(3);
ALTER TABLE "Trip" ADD COLUMN "checkOutAt" TIMESTAMP(3);

ALTER TABLE "ManualValidation" ADD COLUMN "validationStage" "ValidationStage" NOT NULL DEFAULT 'CHECK_OUT';
ALTER TABLE "ManualValidation" ADD COLUMN "gateType" "GateType";
ALTER TABLE "ManualValidation" ADD COLUMN "appCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ManualValidation" ADD COLUMN "complianceScore" INTEGER;
ALTER TABLE "ManualValidation" ADD COLUMN "complianceStatus" "ComplianceStatus";

CREATE UNIQUE INDEX "TravelAgent_email_key" ON "TravelAgent"("email");
CREATE INDEX "TravelAgent_status_idx" ON "TravelAgent"("status");

CREATE UNIQUE INDEX "TravelAgentOrganization_travelAgentId_organizationId_key" ON "TravelAgentOrganization"("travelAgentId", "organizationId");
CREATE INDEX "TravelAgentOrganization_organizationId_status_idx" ON "TravelAgentOrganization"("organizationId", "status");
CREATE INDEX "TravelAgentOrganization_travelAgentId_status_idx" ON "TravelAgentOrganization"("travelAgentId", "status");

CREATE UNIQUE INDEX "TravelAgentInvite_token_key" ON "TravelAgentInvite"("token");
CREATE INDEX "TravelAgentInvite_email_status_idx" ON "TravelAgentInvite"("email", "status");
CREATE INDEX "TravelAgentInvite_organizationId_status_idx" ON "TravelAgentInvite"("organizationId", "status");

CREATE UNIQUE INDEX "TravelAgentUser_travelAgentId_userId_key" ON "TravelAgentUser"("travelAgentId", "userId");
CREATE INDEX "TravelAgentUser_userId_idx" ON "TravelAgentUser"("userId");

CREATE INDEX "Trip_travelAgentId_idx" ON "Trip"("travelAgentId");
CREATE INDEX "Trip_complianceStatus_idx" ON "Trip"("complianceStatus");
CREATE INDEX "ManualValidation_validationStage_idx" ON "ManualValidation"("validationStage");
CREATE INDEX "ManualValidation_complianceStatus_idx" ON "ManualValidation"("complianceStatus");

ALTER TABLE "TravelAgentOrganization" ADD CONSTRAINT "TravelAgentOrganization_travelAgentId_fkey" FOREIGN KEY ("travelAgentId") REFERENCES "TravelAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelAgentOrganization" ADD CONSTRAINT "TravelAgentOrganization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelAgentInvite" ADD CONSTRAINT "TravelAgentInvite_travelAgentId_fkey" FOREIGN KEY ("travelAgentId") REFERENCES "TravelAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TravelAgentInvite" ADD CONSTRAINT "TravelAgentInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelAgentUser" ADD CONSTRAINT "TravelAgentUser_travelAgentId_fkey" FOREIGN KEY ("travelAgentId") REFERENCES "TravelAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TravelAgentUser" ADD CONSTRAINT "TravelAgentUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_travelAgentId_fkey" FOREIGN KEY ("travelAgentId") REFERENCES "TravelAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
