-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'ADMIN', 'PENGEPUL', 'USER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('SCHOOL', 'CAMPUS', 'VILLAGE', 'TOURISM_SITE', 'OFFICE', 'COMMUNITY', 'WASTE_BANK', 'OTHER');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('INVITED', 'REQUESTED', 'PENDING_SUPERADMIN_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REMOVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RegionType" AS ENUM ('PROVINCE', 'REGENCY', 'DISTRICT', 'VILLAGE');

-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('ONLINE', 'OFFLINE', 'FULL', 'MAINTENANCE', 'ERROR');

-- CreateEnum
CREATE TYPE "WasteUnit" AS ENUM ('ITEM', 'KG');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('MACHINE_DEPOSIT', 'TRASH_BAG', 'EVENT', 'SCHOOL_PROGRAM', 'TOURISM_PROGRAM');

-- CreateEnum
CREATE TYPE "CampaignVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('RESERVED', 'ACTIVE', 'PROCESSING_ITEM', 'COMPLETED', 'REVIEW', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DepositItemStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REVIEW');

-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('MACHINE', 'MANUAL', 'PYTHON_SIMULATOR');

-- CreateEnum
CREATE TYPE "CompactionStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'COMPACTED', 'FAILED');

-- CreateEnum
CREATE TYPE "MachineEventType" AS ENUM ('HEARTBEAT', 'QR_REFRESHED', 'CHAMBER_OPENED', 'CHAMBER_TIMEOUT', 'ITEM_DETECTED', 'WEIGHT_MEASURED', 'IMAGE_CLASSIFIED', 'BARCODE_READ', 'SENSOR_SEQUENCE', 'ITEM_ACCEPTED_POINT', 'ITEM_REJECTED', 'CONVEYOR_STARTED', 'COMPACTION_STARTED', 'COMPACTION_COMPLETED', 'FRAUD_DETECTED', 'VANDALISM_DETECTED', 'SAFE_STATE_ENTERED', 'STATUS_CHANGED', 'FILL_LEVEL_UPDATED', 'ERROR');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('EARN', 'REDEEM', 'PENALTY', 'REVERSE', 'ADJUST');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REDEEMED', 'REVERSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayoutProviderType" AS ENUM ('LINKAJA', 'GOPAY', 'OVO', 'DANA', 'SHOPEEPAY', 'BANK', 'OTHER');

-- CreateEnum
CREATE TYPE "PayoutAccountStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'DISABLED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RedemptionMethod" AS ENUM ('MANUAL_TRANSFER', 'PROVIDER_API');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'ON_THE_WAY', 'ARRIVED', 'COLLECTED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickupReason" AS ENUM ('FULL', 'SCHEDULED', 'MANUAL', 'ERROR');

-- CreateEnum
CREATE TYPE "PickupItemSource" AS ENUM ('MACHINE_COUNT', 'MANUAL_WEIGHING');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConditionStatus" AS ENUM ('GOOD', 'PARTIAL', 'POOR', 'NOT_RETURNED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "authProvider" TEXT NOT NULL DEFAULT 'CREDENTIALS',
    "role" "Role" NOT NULL DEFAULT 'USER',
    "organizationId" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "payoutEligible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL DEFAULT 'OTHER',
    "provinceId" TEXT,
    "regencyId" TEXT,
    "districtId" TEXT,
    "villageId" TEXT,
    "regionId" TEXT,
    "address" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "type" "RegionType" NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationCollectorPartner" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "collectorUserId" TEXT NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING_SUPERADMIN_APPROVAL',
    "serviceAreaJson" JSONB,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "approvedBySuperadminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationCollectorPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "regionId" TEXT,
    "machineCode" TEXT NOT NULL,
    "qrToken" TEXT,
    "qrTokenExpiresAt" TIMESTAMP(3),
    "qrRotationSeconds" INTEGER NOT NULL DEFAULT 30,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "MachineStatus" NOT NULL DEFAULT 'OFFLINE',
    "fillLevelPercent" INTEGER NOT NULL DEFAULT 0,
    "capacityKg" DOUBLE PRECISION,
    "hasInputChamber" BOOLEAN NOT NULL DEFAULT true,
    "hasConveyor" BOOLEAN NOT NULL DEFAULT true,
    "hasCompactor" BOOLEAN NOT NULL DEFAULT false,
    "hasExternalCamera" BOOLEAN NOT NULL DEFAULT false,
    "chamberTimeoutSeconds" INTEGER NOT NULL DEFAULT 20,
    "lastHeartbeatAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "WasteUnit" NOT NULL DEFAULT 'ITEM',
    "minWeightGrams" INTEGER,
    "maxWeightGrams" INTEGER,
    "defaultRewardPerItem" INTEGER,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WasteType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineWasteType" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "wasteTypeId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MachineWasteType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "campaignId" TEXT,
    "wasteTypeId" TEXT NOT NULL,
    "unit" "WasteUnit" NOT NULL DEFAULT 'ITEM',
    "pointsPerItem" INTEGER NOT NULL,
    "minWeightGrams" INTEGER,
    "maxWeightGrams" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "campaignType" "CampaignType" NOT NULL DEFAULT 'MACHINE_DEPOSIT',
    "visibility" "CampaignVisibility" NOT NULL DEFAULT 'PUBLIC',
    "allowedEmailDomainsJson" JSONB,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "rewardMultiplier" DOUBLE PRECISION,
    "rulesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "campaignId" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'RESERVED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "timeoutAt" TIMESTAMP(3),
    "anomalyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "wasteTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "measuredWeightGrams" INTEGER,
    "aiDetectedType" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "barcodeValue" TEXT,
    "rewardRateId" TEXT,
    "rewardAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "DepositItemStatus" NOT NULL DEFAULT 'PENDING',
    "source" "ItemSource" NOT NULL DEFAULT 'PYTHON_SIMULATOR',
    "validationReasonCode" TEXT,
    "sensorSequenceJson" JSONB,
    "acceptedAt" TIMESTAMP(3),
    "acceptanceEventId" TEXT,
    "externalFraudFlag" BOOLEAN NOT NULL DEFAULT false,
    "compactionStatus" "CompactionStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "evidenceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineEvent" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "sessionId" TEXT,
    "depositItemId" TEXT,
    "localEventId" TEXT NOT NULL,
    "eventType" "MachineEventType" NOT NULL,
    "payloadJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "sessionId" TEXT,
    "depositItemId" TEXT,
    "campaignId" TEXT,
    "entryType" "LedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "LedgerStatus" NOT NULL DEFAULT 'PENDING',
    "reasonCode" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PayoutProviderType" NOT NULL,
    "accountIdentifier" TEXT NOT NULL,
    "accountName" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "status" "PayoutAccountStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "kycRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PayoutProviderType" NOT NULL DEFAULT 'OTHER',
    "payoutAccountId" TEXT,
    "amount" INTEGER NOT NULL,
    "method" "RedemptionMethod" NOT NULL DEFAULT 'MANUAL_TRANSFER',
    "status" "RedemptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "providerReference" TEXT,
    "manualTransferProofUrl" TEXT,
    "note" TEXT,
    "processedBySuperadminId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupRequest" (
    "id" TEXT NOT NULL,
    "machineId" TEXT,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "assignedCollectorId" TEXT,
    "collectorPartnerId" TEXT,
    "status" "PickupStatus" NOT NULL DEFAULT 'REQUESTED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "reason" "PickupReason" NOT NULL DEFAULT 'FULL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupItem" (
    "id" TEXT NOT NULL,
    "pickupRequestId" TEXT NOT NULL,
    "wasteTypeId" TEXT,
    "estimatedWeightKg" DOUBLE PRECISION,
    "actualWeightKg" DOUBLE PRECISION,
    "itemCount" INTEGER,
    "source" "PickupItemSource" NOT NULL DEFAULT 'MANUAL_WEIGHING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "travelAgentName" TEXT,
    "groupName" TEXT,
    "leaderName" TEXT,
    "leaderContact" TEXT,
    "participantCount" INTEGER NOT NULL DEFAULT 1,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrashBagAssignment" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "assignedById" TEXT,
    "bagQrCode" TEXT NOT NULL,
    "bagCount" INTEGER NOT NULL DEFAULT 1,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrashBagAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualValidation" (
    "id" TEXT NOT NULL,
    "tripId" TEXT,
    "validatedById" TEXT,
    "bagQrCode" TEXT,
    "returnedBagCount" INTEGER,
    "actualWeightKg" DOUBLE PRECISION,
    "conditionStatus" "ConditionStatus",
    "notes" TEXT,
    "evidenceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Organization_regionId_idx" ON "Organization"("regionId");

-- CreateIndex
CREATE INDEX "Organization_type_idx" ON "Organization"("type");

-- CreateIndex
CREATE INDEX "Region_parentId_idx" ON "Region"("parentId");

-- CreateIndex
CREATE INDEX "Region_type_idx" ON "Region"("type");

-- CreateIndex
CREATE INDEX "OrganizationCollectorPartner_collectorUserId_status_idx" ON "OrganizationCollectorPartner"("collectorUserId", "status");

-- CreateIndex
CREATE INDEX "OrganizationCollectorPartner_organizationId_status_idx" ON "OrganizationCollectorPartner"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationCollectorPartner_organizationId_collectorUserId_key" ON "OrganizationCollectorPartner"("organizationId", "collectorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_machineCode_key" ON "Machine"("machineCode");

-- CreateIndex
CREATE INDEX "Machine_organizationId_idx" ON "Machine"("organizationId");

-- CreateIndex
CREATE INDEX "Machine_status_idx" ON "Machine"("status");

-- CreateIndex
CREATE INDEX "WasteType_organizationId_idx" ON "WasteType"("organizationId");

-- CreateIndex
CREATE INDEX "MachineWasteType_wasteTypeId_idx" ON "MachineWasteType"("wasteTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineWasteType_machineId_wasteTypeId_key" ON "MachineWasteType"("machineId", "wasteTypeId");

-- CreateIndex
CREATE INDEX "RewardRate_wasteTypeId_active_idx" ON "RewardRate"("wasteTypeId", "active");

-- CreateIndex
CREATE INDEX "RewardRate_organizationId_idx" ON "RewardRate"("organizationId");

-- CreateIndex
CREATE INDEX "RewardRate_campaignId_idx" ON "RewardRate"("campaignId");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_status_idx" ON "Campaign"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DepositSession_userId_idx" ON "DepositSession"("userId");

-- CreateIndex
CREATE INDEX "DepositSession_machineId_status_idx" ON "DepositSession"("machineId", "status");

-- CreateIndex
CREATE INDEX "DepositItem_sessionId_idx" ON "DepositItem"("sessionId");

-- CreateIndex
CREATE INDEX "DepositItem_status_idx" ON "DepositItem"("status");

-- CreateIndex
CREATE INDEX "MachineEvent_machineId_occurredAt_idx" ON "MachineEvent"("machineId", "occurredAt");

-- CreateIndex
CREATE INDEX "MachineEvent_sessionId_idx" ON "MachineEvent"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineEvent_machineId_localEventId_key" ON "MachineEvent"("machineId", "localEventId");

-- CreateIndex
CREATE INDEX "RewardLedger_userId_status_idx" ON "RewardLedger"("userId", "status");

-- CreateIndex
CREATE INDEX "RewardLedger_sessionId_idx" ON "RewardLedger"("sessionId");

-- CreateIndex
CREATE INDEX "RewardLedger_depositItemId_idx" ON "RewardLedger"("depositItemId");

-- CreateIndex
CREATE INDEX "PayoutAccount_userId_idx" ON "PayoutAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_idempotencyKey_key" ON "Redemption"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Redemption_userId_status_idx" ON "Redemption"("userId", "status");

-- CreateIndex
CREATE INDEX "Redemption_status_idx" ON "Redemption"("status");

-- CreateIndex
CREATE INDEX "PickupRequest_organizationId_status_idx" ON "PickupRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PickupRequest_assignedCollectorId_idx" ON "PickupRequest"("assignedCollectorId");

-- CreateIndex
CREATE INDEX "PickupItem_pickupRequestId_idx" ON "PickupItem"("pickupRequestId");

-- CreateIndex
CREATE INDEX "Trip_campaignId_idx" ON "Trip"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "TrashBagAssignment_bagQrCode_key" ON "TrashBagAssignment"("bagQrCode");

-- CreateIndex
CREATE INDEX "TrashBagAssignment_tripId_idx" ON "TrashBagAssignment"("tripId");

-- CreateIndex
CREATE INDEX "ManualValidation_tripId_idx" ON "ManualValidation"("tripId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCollectorPartner" ADD CONSTRAINT "OrganizationCollectorPartner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCollectorPartner" ADD CONSTRAINT "OrganizationCollectorPartner_collectorUserId_fkey" FOREIGN KEY ("collectorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineWasteType" ADD CONSTRAINT "MachineWasteType_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineWasteType" ADD CONSTRAINT "MachineWasteType_wasteTypeId_fkey" FOREIGN KEY ("wasteTypeId") REFERENCES "WasteType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRate" ADD CONSTRAINT "RewardRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRate" ADD CONSTRAINT "RewardRate_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRate" ADD CONSTRAINT "RewardRate_wasteTypeId_fkey" FOREIGN KEY ("wasteTypeId") REFERENCES "WasteType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositSession" ADD CONSTRAINT "DepositSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositSession" ADD CONSTRAINT "DepositSession_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositSession" ADD CONSTRAINT "DepositSession_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositItem" ADD CONSTRAINT "DepositItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DepositSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositItem" ADD CONSTRAINT "DepositItem_wasteTypeId_fkey" FOREIGN KEY ("wasteTypeId") REFERENCES "WasteType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositItem" ADD CONSTRAINT "DepositItem_rewardRateId_fkey" FOREIGN KEY ("rewardRateId") REFERENCES "RewardRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DepositSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_depositItemId_fkey" FOREIGN KEY ("depositItemId") REFERENCES "DepositItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLedger" ADD CONSTRAINT "RewardLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLedger" ADD CONSTRAINT "RewardLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLedger" ADD CONSTRAINT "RewardLedger_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DepositSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLedger" ADD CONSTRAINT "RewardLedger_depositItemId_fkey" FOREIGN KEY ("depositItemId") REFERENCES "DepositItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLedger" ADD CONSTRAINT "RewardLedger_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_assignedCollectorId_fkey" FOREIGN KEY ("assignedCollectorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_collectorPartnerId_fkey" FOREIGN KEY ("collectorPartnerId") REFERENCES "OrganizationCollectorPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupItem" ADD CONSTRAINT "PickupItem_pickupRequestId_fkey" FOREIGN KEY ("pickupRequestId") REFERENCES "PickupRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupItem" ADD CONSTRAINT "PickupItem_wasteTypeId_fkey" FOREIGN KEY ("wasteTypeId") REFERENCES "WasteType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrashBagAssignment" ADD CONSTRAINT "TrashBagAssignment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualValidation" ADD CONSTRAINT "ManualValidation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
