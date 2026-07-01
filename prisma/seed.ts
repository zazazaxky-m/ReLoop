import { prisma } from "../lib/prisma";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { generateIngestSecret } from "../lib/machine-auth";

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
  await prisma.travelAgentInvite.deleteMany();
  await prisma.travelAgentUser.deleteMany();
  await prisma.travelAgentOrganization.deleteMany();
  await prisma.travelAgent.deleteMany();
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
  const orgC = await prisma.organization.create({
    data: {
      name: "Pantai Batu Hiu",
      type: "TOURISM_SITE",
      provinceId: jabar.id,
      regencyId: pangandaranRegency.id,
      districtId: pangandaranDistrict.id,
      villageId: wonoharjo.id,
      regionId: wonoharjo.id,
      address: "Jl. Pantai Batu Hiu, Pangandaran",
      contactName: "Dewi Lestari",
      contactPhone: "081200000003",
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
  const adminTourism = await prisma.user.create({
    data: { name: "Admin Batu Hiu", email: "admin.batuhiu@reloop.id", phone: "081100000004", passwordHash, role: "ADMIN", organizationId: orgC.id },
  });
  const pengepul = await prisma.user.create({
    data: { name: "Pengepul Sejahtera", email: "pengepul@reloop.id", phone: "081100000002", passwordHash, role: "PENGEPUL" },
  });
  const user = await prisma.user.create({
    data: { name: "Warga Pangandaran", email: "user@reloop.id", phone: "081100000003", passwordHash, role: "USER" },
  });
  const travelAgentOwner = await prisma.user.create({
    data: { name: "Owner Cahaya Tour", email: "cahaya@travel.test", phone: "081177700001", passwordHash, role: "USER" },
  });
  const multiAgentOwner = await prisma.user.create({
    data: { name: "Owner Nusantara Holiday", email: "nusantara@travel.test", phone: "081177700003", passwordHash, role: "USER" },
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
  const organik = await prisma.wasteType.create({
    data: {
      name: "Organik",
      unit: "KG",
      minWeightGrams: 100,
      maxWeightGrams: 50000,
      defaultRewardPerItem: 100,
      description: "Sampah organik seperti sisa makanan, daun, dan material mudah terurai.",
      active: true,
    },
  });
  const anorganik = await prisma.wasteType.create({
    data: {
      name: "Anorganik",
      unit: "KG",
      minWeightGrams: 100,
      maxWeightGrams: 50000,
      defaultRewardPerItem: 150,
      description: "Sampah anorganik seperti plastik, logam, kaca, dan material sulit terurai.",
      active: true,
    },
  });

  // ---------- Reward rates (global / per item) ----------
  await prisma.rewardRate.create({
    data: { wasteTypeId: organik.id, unit: "KG", pointsPerItem: 100, minWeightGrams: 100, maxWeightGrams: 50000, active: true },
  });
  await prisma.rewardRate.create({
    data: { wasteTypeId: anorganik.id, unit: "KG", pointsPerItem: 150, minWeightGrams: 100, maxWeightGrams: 50000, active: true },
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
        { machineId: m.id, wasteTypeId: organik.id, active: true },
        { machineId: m.id, wasteTypeId: anorganik.id, active: true },
      ],
    });
  }

  // ---------- Campaigns (public + private) ----------
  const campaignPublic = await prisma.campaign.create({
    data: {
      organizationId: orgA.id, name: "Gerakan Bersih Pantai",
      description: "Setor sampah organik dan anorganik selama musim liburan, reward ekstra!",
      campaignType: "MACHINE_DEPOSIT", rewardMode: "MONEY_REWARD", visibility: "PUBLIC", status: "ACTIVE",
      startAt: daysAgo(7), endAt: new Date(Date.now() + 30 * 86_400_000), rewardMultiplier: 1.2,
    },
  });
  const campaignTourism = await prisma.campaign.create({
    data: {
      organizationId: orgA.id,
      name: "Uji Coba Trash Bag Wisata Pangandaran",
      description: "Program compliance-only untuk wisatawan travel agent di gerbang masuk dan gerbang pulang.",
      campaignType: "TOURISM_PROGRAM",
      rewardMode: "COMPLIANCE_ONLY",
      visibility: "PUBLIC",
      status: "ACTIVE",
      startAt: daysAgo(1),
      endAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  await prisma.campaign.create({
    data: {
      organizationId: orgB.id, name: "Bank Sampah Sekolah SMAN 1",
      description: "Program khusus warga sekolah (validasi domain email).",
      campaignType: "SCHOOL_PROGRAM", rewardMode: "MONEY_REWARD", visibility: "PRIVATE",
      allowedEmailDomainsJson: ["@sman1pangandaran.sch.id"], status: "ACTIVE",
      startAt: daysAgo(3), endAt: new Date(Date.now() + 60 * 86_400_000),
    },
  });

  // ---------- Demo tourism compliance ----------
  const invitedAgent = await prisma.travelAgent.create({
    data: {
      name: "Cahaya Pangandaran Tour",
      email: travelAgentOwner.email,
      phone: travelAgentOwner.phone,
      contactPerson: "Pak Rian Travel",
    },
  });
  await prisma.travelAgentOrganization.create({
    data: {
      travelAgentId: invitedAgent.id,
      organizationId: orgA.id,
      status: "INVITED",
      invitedById: admin.id,
      approvedAt: new Date(),
    },
  });
  await prisma.travelAgentInvite.create({
    data: {
      travelAgentId: invitedAgent.id,
      organizationId: orgA.id,
      email: invitedAgent.email,
      status: "INVITED",
      invitedById: admin.id,
    },
  });
  await prisma.travelAgentUser.create({
    data: { travelAgentId: invitedAgent.id, userId: travelAgentOwner.id, roleInAgent: "OWNER" },
  });

  const pendingAgent = await prisma.travelAgent.create({
    data: {
      name: "Laut Selatan Travel",
      email: "pending.agent@travel.test",
      phone: "081177700005",
      contactPerson: "Mbak Nia",
    },
  });
  await prisma.travelAgentOrganization.create({
    data: {
      travelAgentId: pendingAgent.id,
      organizationId: orgA.id,
      status: "PENDING",
      invitedById: admin.id,
      notes: "Email belum punya akun user. Akan otomatis INVITED setelah register memakai email ini.",
    },
  });
  await prisma.travelAgentInvite.create({
    data: {
      travelAgentId: pendingAgent.id,
      organizationId: orgA.id,
      email: pendingAgent.email,
      status: "PENDING",
      invitedById: admin.id,
    },
  });

  const multiOrgAgent = await prisma.travelAgent.create({
    data: {
      name: "Nusantara Holiday",
      email: multiAgentOwner.email,
      phone: multiAgentOwner.phone,
      contactPerson: "Kak Dimas",
    },
  });
  await prisma.travelAgentOrganization.createMany({
    data: [
      {
        travelAgentId: multiOrgAgent.id,
        organizationId: orgA.id,
        status: "INVITED",
        invitedById: admin.id,
        approvedAt: new Date(),
        notes: "Agent yang sama aktif di program Pangandaran.",
      },
      {
        travelAgentId: multiOrgAgent.id,
        organizationId: orgC.id,
        status: "INVITED",
        invitedById: adminTourism.id,
        approvedAt: new Date(),
        notes: "Agent yang sama juga terhubung ke tempat wisata lain.",
      },
    ],
  });
  await prisma.travelAgentInvite.createMany({
    data: [
      {
        travelAgentId: multiOrgAgent.id,
        organizationId: orgA.id,
        email: multiOrgAgent.email,
        status: "INVITED",
        invitedById: admin.id,
      },
      {
        travelAgentId: multiOrgAgent.id,
        organizationId: orgC.id,
        email: multiOrgAgent.email,
        status: "INVITED",
        invitedById: adminTourism.id,
      },
    ],
  });
  await prisma.travelAgentUser.create({
    data: { travelAgentId: multiOrgAgent.id, userId: multiAgentOwner.id, roleInAgent: "OWNER" },
  });
  const tourismTrip = await prisma.trip.create({
    data: {
      campaignId: campaignTourism.id,
      travelAgentId: invitedAgent.id,
      travelAgentName: invitedAgent.name,
      userId: travelAgentOwner.id,
      groupName: "Rombongan Pantai Barat",
      leaderName: "Ibu Sari",
      leaderContact: "081177700002",
      participantCount: 32,
      status: "ACTIVE",
      complianceStatus: "CHECKED_IN",
      complianceScore: 30,
      checkInAt: new Date(),
    },
  });
  await prisma.trashBagAssignment.createMany({
    data: [
      { tripId: tourismTrip.id, assignedById: admin.id, bagQrCode: "BAG-DEMO-001", wasteTypeId: organik.id },
      { tripId: tourismTrip.id, assignedById: admin.id, bagQrCode: "BAG-DEMO-002", wasteTypeId: anorganik.id },
    ],
  });
  await prisma.manualValidation.create({
    data: {
      tripId: tourismTrip.id,
      validatedById: admin.id,
      validationStage: "CHECK_IN",
      gateType: "ENTRY",
      appCompleted: true,
      complianceScore: 30,
      complianceStatus: "CHECKED_IN",
      notes: "Demo check-in gerbang masuk.",
    },
  });

  const completedTourismTrip = await prisma.trip.create({
    data: {
      campaignId: campaignTourism.id,
      travelAgentId: multiOrgAgent.id,
      travelAgentName: multiOrgAgent.name,
      userId: multiAgentOwner.id,
      groupName: "Rombongan Green Trip",
      leaderName: "Pak Dimas",
      leaderContact: "081177700004",
      participantCount: 24,
      status: "COMPLETED",
      complianceStatus: "COMPLIANT",
      complianceScore: 100,
      checkInAt: daysAgo(1),
      checkOutAt: new Date(),
    },
  });
  await prisma.trashBagAssignment.createMany({
    data: [
      { tripId: completedTourismTrip.id, assignedById: admin.id, bagQrCode: "BAG-DEMO-101", wasteTypeId: organik.id },
      { tripId: completedTourismTrip.id, assignedById: admin.id, bagQrCode: "BAG-DEMO-102", wasteTypeId: anorganik.id },
    ],
  });
  await prisma.manualValidation.createMany({
    data: [
      {
        tripId: completedTourismTrip.id,
        validatedById: admin.id,
        validationStage: "CHECK_IN",
        gateType: "ENTRY",
        appCompleted: true,
        complianceScore: 30,
        complianceStatus: "CHECKED_IN",
        notes: "Aplikasi sudah diisi saat kedatangan.",
      },
      {
        tripId: completedTourismTrip.id,
        validatedById: admin.id,
        validationStage: "CHECK_OUT",
        gateType: "EXIT",
        bagQrCode: "BAG-DEMO-101",
        returnedBagCount: 2,
        actualWeightKg: 4.8,
        conditionStatus: "GOOD",
        appCompleted: true,
        complianceScore: 100,
        complianceStatus: "COMPLIANT",
        notes: "Trash bag kembali lengkap dan sampah terpilah.",
      },
    ],
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
    data: { sessionId: sessionA.id, wasteTypeId: organik.id, quantity: 20, measuredWeightGrams: 220, rewardAmount: 4000, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(2), createdAt: daysAgo(2) },
  });
  const a2 = await prisma.depositItem.create({
    data: { sessionId: sessionA.id, wasteTypeId: anorganik.id, quantity: 16, measuredWeightGrams: 180, rewardAmount: 4000, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(2), createdAt: daysAgo(2) },
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
    data: { sessionId: sessionB.id, wasteTypeId: organik.id, quantity: 15, measuredWeightGrams: 260, rewardAmount: 3000, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(1), createdAt: daysAgo(1) },
  });
  const b2 = await prisma.depositItem.create({
    data: { sessionId: sessionB.id, wasteTypeId: anorganik.id, quantity: 6, measuredWeightGrams: 140, rewardAmount: 1500, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(1), createdAt: daysAgo(1) },
  });
  // Anomaly item: reward held PENDING for review.
  const b3 = await prisma.depositItem.create({
    data: { sessionId: sessionB.id, wasteTypeId: anorganik.id, quantity: 1, measuredWeightGrams: 90000, rewardAmount: 200, status: "REVIEW", source: "PYTHON_SIMULATOR", validationReasonCode: "WEIGHT_OVER_MAX_OR_STRING_PULL", externalFraudFlag: true, createdAt: daysAgo(1) },
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
  console.log("  admin.batuhiu@reloop.id (ADMIN - Pantai Batu Hiu)");
  console.log("  pengepul@reloop.id    (PENGEPUL - active partner of org A)");
  console.log("  user@reloop.id        (USER - balance Rp12.500, Rp200 pending)");
  console.log("  cahaya@travel.test    (USER - Travel Agent INVITED)");
  console.log("  nusantara@travel.test (USER - Travel Agent multi-tempat wisata)");
  console.log("  pending.agent@travel.test belum punya akun, status seed = PENDING");
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
