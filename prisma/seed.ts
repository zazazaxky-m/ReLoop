import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { generateIngestSecret } from "../lib/machine-auth";

const prisma = new PrismaClient();

function token() {
  return randomUUID().replace(/-/g, "");
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function wipe() {
  // Delete in FK-safe order (children first).
  await prisma.rewardLedger.deleteMany();
  await prisma.machineEvent.deleteMany();
  await prisma.depositItem.deleteMany();
  await prisma.depositSession.deleteMany();
  await prisma.pickupItem.deleteMany();
  await prisma.pickupRequest.deleteMany();
  await prisma.trashBagAssignment.deleteMany();
  await prisma.manualValidation.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.redemption.deleteMany();
  await prisma.payoutAccount.deleteMany();
  await prisma.rewardRate.deleteMany();
  await prisma.machineWasteType.deleteMany();
  await prisma.machine.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.organizationCollectorPartner.deleteMany();
  await prisma.wasteType.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.region.deleteMany();
  await prisma.systemConfig.deleteMany();
}

async function main() {
  console.log("Seeding ReLoop database...");
  await wipe();

  const passwordHash = await bcrypt.hash("password123", 10);

  // ---------- Regions (Jawa Barat -> Pangandaran) ----------
  const jabar = await prisma.region.create({
    data: { type: "PROVINCE", name: "Jawa Barat" },
  });
  const pangandaranRegency = await prisma.region.create({
    data: { type: "REGENCY", name: "Kabupaten Pangandaran", parentId: jabar.id },
  });
  // Second regency to demonstrate Jawa Barat expansion readiness.
  await prisma.region.create({
    data: { type: "REGENCY", name: "Kota Bandung", parentId: jabar.id },
  });
  const pangandaranDistrict = await prisma.region.create({
    data: { type: "DISTRICT", name: "Pangandaran", parentId: pangandaranRegency.id },
  });
  const pananjung = await prisma.region.create({
    data: { type: "VILLAGE", name: "Pananjung", parentId: pangandaranDistrict.id },
  });
  const wonoharjo = await prisma.region.create({
    data: { type: "VILLAGE", name: "Wonoharjo", parentId: pangandaranDistrict.id },
  });

  // ---------- Organizations (tenants) ----------
  const orgA = await prisma.organization.create({
    data: {
      name: "Bank Sampah Pangandaran",
      type: "WASTE_BANK",
      provinceId: jabar.id,
      regencyId: pangandaranRegency.id,
      districtId: pangandaranDistrict.id,
      villageId: pananjung.id,
      regionId: pananjung.id,
      address: "Jl. Pantai Barat No. 1, Pangandaran",
      contactName: "Budi Santoso",
      contactPhone: "081200000001",
      status: "ACTIVE",
    },
  });
  const orgB = await prisma.organization.create({
    data: {
      name: "SMAN 1 Pangandaran",
      type: "SCHOOL",
      provinceId: jabar.id,
      regencyId: pangandaranRegency.id,
      districtId: pangandaranDistrict.id,
      villageId: wonoharjo.id,
      regionId: wonoharjo.id,
      address: "Jl. Pendidikan No. 10, Pangandaran",
      contactName: "Sri Wahyuni",
      contactPhone: "081200000002",
      status: "ACTIVE",
    },
  });

  // ---------- Users ----------
  const superadmin = await prisma.user.create({
    data: { name: "Super Admin", email: "superadmin@reloop.id", phone: "081100000000", passwordHash, role: "SUPERADMIN" },
  });
  const admin = await prisma.user.create({
    data: { name: "Admin Pangandaran", email: "admin@reloop.id", phone: "081100000001", passwordHash, role: "ADMIN", organizationId: orgA.id },
  });
  const pengepul = await prisma.user.create({
    data: { name: "Pengepul Sejahtera", email: "pengepul@reloop.id", phone: "081100000002", passwordHash, role: "PENGEPUL" },
  });
  const user = await prisma.user.create({
    data: { name: "Warga Pangandaran", email: "user@reloop.id", phone: "081100000003", passwordHash, role: "USER" },
  });

  // ---------- Collector partnerships ----------
  await prisma.organizationCollectorPartner.create({
    data: {
      organizationId: orgA.id,
      collectorUserId: pengepul.id,
      status: "ACTIVE",
      serviceAreaJson: { regions: ["Pangandaran"], note: "Wilayah pesisir Pangandaran" },
      contactName: "Pengepul Sejahtera",
      contactPhone: "081100000002",
      createdByAdminId: admin.id,
      approvedBySuperadminId: superadmin.id,
    },
  });
  // A pending partnership to demonstrate the superadmin approval workflow.
  await prisma.organizationCollectorPartner.create({
    data: {
      organizationId: orgB.id,
      collectorUserId: pengepul.id,
      status: "PENDING_SUPERADMIN_APPROVAL",
      serviceAreaJson: { regions: ["Pangandaran"] },
      createdByAdminId: admin.id,
    },
  });

  // ---------- Waste types (global, superadmin-managed) ----------
  const botol = await prisma.wasteType.create({
    data: {
      name: "Botol Plastik (PET)",
      unit: "ITEM",
      minWeightGrams: 5,
      maxWeightGrams: 80,
      defaultRewardPerItem: 200,
      description: "Botol plastik PET bekas minuman. Harus kosong (threshold berat menolak botol berisi air).",
      active: true,
    },
  });
  const kaleng = await prisma.wasteType.create({
    data: {
      name: "Kaleng Aluminium",
      unit: "ITEM",
      minWeightGrams: 8,
      maxWeightGrams: 50,
      defaultRewardPerItem: 250,
      description: "Kaleng minuman aluminium bekas.",
      active: true,
    },
  });

  // ---------- Reward rates (global / per item) ----------
  await prisma.rewardRate.create({
    data: { wasteTypeId: botol.id, unit: "ITEM", pointsPerItem: 200, minWeightGrams: 5, maxWeightGrams: 80, active: true },
  });
  await prisma.rewardRate.create({
    data: { wasteTypeId: kaleng.id, unit: "ITEM", pointsPerItem: 250, minWeightGrams: 8, maxWeightGrams: 50, active: true },
  });

  // ---------- Machines ----------
  // Per-machine HMAC ingest secrets (printed below for the simulator).
  const secrets: Record<string, string> = {
    "RLP-001": generateIngestSecret(),
    "RLP-002": generateIngestSecret(),
    "SMA-001": generateIngestSecret(),
  };
  const m1 = await prisma.machine.create({
    data: {
      organizationId: orgA.id, regionId: pananjung.id, machineCode: "RLP-001",
      name: "Mesin Pantai Pangandaran", description: "Dekat gerbang Pantai Barat",
      status: "ONLINE", fillLevelPercent: 35, capacityKg: 50,
      hasInputChamber: true, hasConveyor: true, hasCompactor: true, hasExternalCamera: true,
      chamberTimeoutSeconds: 20, qrRotationSeconds: 30,
      qrToken: token(), qrTokenExpiresAt: new Date(Date.now() + 3_600_000),
      ingestSecret: secrets["RLP-001"],
      lastHeartbeatAt: new Date(), latitude: -7.6886, longitude: 108.6531,
    },
  });
  const m2 = await prisma.machine.create({
    data: {
      organizationId: orgA.id, regionId: wonoharjo.id, machineCode: "RLP-002",
      name: "Mesin Alun-alun", description: "Dekat alun-alun Pangandaran",
      status: "FULL", fillLevelPercent: 95, capacityKg: 50,
      hasInputChamber: true, hasConveyor: true, hasCompactor: false, hasExternalCamera: true,
      chamberTimeoutSeconds: 20, qrRotationSeconds: 120,
      ingestSecret: secrets["RLP-002"],
      lastHeartbeatAt: new Date(), latitude: -7.6921, longitude: 108.6498,
    },
  });
  const m3 = await prisma.machine.create({
    data: {
      organizationId: orgB.id, regionId: wonoharjo.id, machineCode: "SMA-001",
      name: "Mesin SMAN 1", description: "Lobby sekolah",
      status: "ONLINE", fillLevelPercent: 12, capacityKg: 30,
      hasInputChamber: true, hasConveyor: true, hasCompactor: false, hasExternalCamera: false,
      chamberTimeoutSeconds: 25, qrRotationSeconds: 30,
      qrToken: token(), qrTokenExpiresAt: new Date(Date.now() + 3_600_000),
      ingestSecret: secrets["SMA-001"],
      lastHeartbeatAt: new Date(), latitude: -7.6809, longitude: 108.6573,
    },
  });

  for (const m of [m1, m2, m3]) {
    await prisma.machineWasteType.createMany({
      data: [
        { machineId: m.id, wasteTypeId: botol.id, active: true },
        { machineId: m.id, wasteTypeId: kaleng.id, active: true },
      ],
    });
  }

  // ---------- Campaigns (public + private) ----------
  const campaignPublic = await prisma.campaign.create({
    data: {
      organizationId: orgA.id, name: "Gerakan Bersih Pantai",
      description: "Setor botol & kaleng selama musim liburan, reward ekstra!",
      campaignType: "MACHINE_DEPOSIT", visibility: "PUBLIC", status: "ACTIVE",
      startAt: daysAgo(7), endAt: new Date(Date.now() + 30 * 86_400_000), rewardMultiplier: 1.2,
    },
  });
  await prisma.campaign.create({
    data: {
      organizationId: orgB.id, name: "Bank Sampah Sekolah SMAN 1",
      description: "Program khusus warga sekolah (validasi domain email).",
      campaignType: "SCHOOL_PROGRAM", visibility: "PRIVATE",
      allowedEmailDomainsJson: ["@sman1pangandaran.sch.id"], status: "ACTIVE",
      startAt: daysAgo(3), endAt: new Date(Date.now() + 60 * 86_400_000),
    },
  });

  // ---------- System config ----------
  await prisma.systemConfig.createMany({
    data: [
      { key: "min_redemption", value: "10000" },
      { key: "default_qr_rotation_seconds", value: "30" },
      { key: "points_to_rupiah", value: "1" },
    ],
  });

  // ---------- Demo wallet for the user (so the dashboard is not empty) ----------
  const sessionA = await prisma.depositSession.create({
    data: {
      userId: user.id, machineId: m1.id, campaignId: campaignPublic.id, status: "COMPLETED",
      startedAt: daysAgo(2), completedAt: new Date(daysAgo(2).getTime() + 600_000),
    },
  });
  const a1 = await prisma.depositItem.create({
    data: { sessionId: sessionA.id, wasteTypeId: botol.id, quantity: 20, measuredWeightGrams: 22, rewardAmount: 4000, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(2), createdAt: daysAgo(2) },
  });
  const a2 = await prisma.depositItem.create({
    data: { sessionId: sessionA.id, wasteTypeId: kaleng.id, quantity: 16, measuredWeightGrams: 15, rewardAmount: 4000, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(2), createdAt: daysAgo(2) },
  });
  await prisma.rewardLedger.createMany({
    data: [
      { userId: user.id, organizationId: orgA.id, sessionId: sessionA.id, depositItemId: a1.id, campaignId: campaignPublic.id, entryType: "EARN", amount: 4000, status: "AVAILABLE", reasonCode: "DEPOSIT_ACCEPTED", referenceType: "DepositItem", referenceId: a1.id, createdAt: daysAgo(2) },
      { userId: user.id, organizationId: orgA.id, sessionId: sessionA.id, depositItemId: a2.id, campaignId: campaignPublic.id, entryType: "EARN", amount: 4000, status: "AVAILABLE", reasonCode: "DEPOSIT_ACCEPTED", referenceType: "DepositItem", referenceId: a2.id, createdAt: daysAgo(2) },
    ],
  });

  const sessionB = await prisma.depositSession.create({
    data: {
      userId: user.id, machineId: m1.id, status: "REVIEW",
      startedAt: daysAgo(1), completedAt: new Date(daysAgo(1).getTime() + 500_000), anomalyCount: 1,
    },
  });
  const b1 = await prisma.depositItem.create({
    data: { sessionId: sessionB.id, wasteTypeId: botol.id, quantity: 15, measuredWeightGrams: 21, rewardAmount: 3000, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(1), createdAt: daysAgo(1) },
  });
  const b2 = await prisma.depositItem.create({
    data: { sessionId: sessionB.id, wasteTypeId: kaleng.id, quantity: 6, measuredWeightGrams: 14, rewardAmount: 1500, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(1), createdAt: daysAgo(1) },
  });
  // Anomaly item: reward held PENDING for review.
  const b3 = await prisma.depositItem.create({
    data: { sessionId: sessionB.id, wasteTypeId: botol.id, quantity: 1, measuredWeightGrams: 240, rewardAmount: 200, status: "REVIEW", source: "PYTHON_SIMULATOR", validationReasonCode: "WEIGHT_OVER_MAX_OR_STRING_PULL", externalFraudFlag: true, createdAt: daysAgo(1) },
  });
  await prisma.rewardLedger.createMany({
    data: [
      { userId: user.id, organizationId: orgA.id, sessionId: sessionB.id, depositItemId: b1.id, entryType: "EARN", amount: 3000, status: "AVAILABLE", reasonCode: "DEPOSIT_ACCEPTED", referenceType: "DepositItem", referenceId: b1.id, createdAt: daysAgo(1) },
      { userId: user.id, organizationId: orgA.id, sessionId: sessionB.id, depositItemId: b2.id, entryType: "EARN", amount: 1500, status: "AVAILABLE", reasonCode: "DEPOSIT_ACCEPTED", referenceType: "DepositItem", referenceId: b2.id, createdAt: daysAgo(1) },
      { userId: user.id, organizationId: orgA.id, sessionId: sessionB.id, depositItemId: b3.id, entryType: "EARN", amount: 200, status: "PENDING", reasonCode: "ANOMALY_REVIEW", referenceType: "DepositItem", referenceId: b3.id, createdAt: daysAgo(1) },
    ],
  });

  // ---------- Demo payout account ----------
  await prisma.payoutAccount.create({
    data: { userId: user.id, provider: "GOPAY", accountIdentifier: "081100000003", accountName: "Warga Pangandaran", status: "UNVERIFIED" },
  });

  // ---------- Demo pickup request (machine RLP-002 is FULL) ----------
  await prisma.pickupRequest.create({
    data: { machineId: m2.id, organizationId: orgA.id, requestedById: admin.id, status: "REQUESTED", reason: "FULL", priority: 1, notes: "Mesin penuh, mohon dijadwalkan pengambilan." },
  });

  console.log("\nSeed complete!");
  console.log("Demo accounts (password: password123):");
  console.log("  superadmin@reloop.id  (SUPERADMIN)");
  console.log("  admin@reloop.id       (ADMIN - Bank Sampah Pangandaran)");
  console.log("  pengepul@reloop.id    (PENGEPUL - active partner of org A)");
  console.log("  user@reloop.id        (USER - balance Rp12.500, Rp200 pending)");
  console.log("\nMachines: RLP-001 (ONLINE), RLP-002 (FULL), SMA-001 (ONLINE)");
  console.log("\nPer-machine ingest secrets (for the Python simulator):");
  for (const [codeName, sec] of Object.entries(secrets)) {
    console.log(`  ${codeName}: ${sec}`);
  }
  console.log(
    "\nSimulate (signed handshake):\n" +
      '  python simulator/simulator.py -m RLP-001 --secret "<SECRET RLP-001>"\n',
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
