import { prisma } from "../lib/prisma";
import bcrypt from "bcryptjs";
import { randomUUID, createHash } from "node:crypto";
import { generateIngestSecret } from "../lib/machine-auth";

function token() {
  return randomUUID().replace(/-/g, "");
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

// ---------- Audit checksum chain helper ----------
const AUDIT_CHECKSUM_SECRET = process.env.AUDIT_CHECKSUM_SECRET ?? "audit-secret-change-me";
let lastAuditChecksum: string | null = null;

function checksumChain(previousHash: string | null, payload: string): string {
  return createHash("sha256")
    .update(`${previousHash ?? ""}${payload}${AUDIT_CHECKSUM_SECRET}`)
    .digest("hex");
}

async function seedAuditLog(input: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date;
}) {
  const ts = input.createdAt ?? new Date();
  const canonical = JSON.stringify({
    ts: ts.toISOString(),
    actor: input.actorId,
    action: input.action,
    entity: `${input.entityType}:${input.entityId}`,
    meta: input.metadata,
  });
  const checksum = checksumChain(lastAuditChecksum, canonical);
  const entry = await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadataJson: (input.metadata ?? undefined) as object | undefined,
      previousHash: lastAuditChecksum,
      checksum,
      createdAt: ts,
    },
  });
  lastAuditChecksum = checksum;
  return entry;
}

async function wipe() {
  // Delete in FK-safe order (children first).
  await prisma.rewardLedger.deleteMany();
  await prisma.machineEvent.deleteMany();
  await prisma.machineCapture.deleteMany();
  await prisma.machineMedia.deleteMany();
  await prisma.machineRemoteCommand.deleteMany();
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
  await prisma.consentRecord.deleteMany();
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

  // ==========================================================
  // Regions (Jawa Barat -> Pangandaran)
  // ==========================================================
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

  // ==========================================================
  // Organizations (tenants)
  // ==========================================================
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

  // ==========================================================
  // Users
  // ==========================================================
  const superadmin = await prisma.user.create({
    data: { name: "Super Admin", email: "superadmin@reloop.id", phone: "081100000000", passwordHash, role: "SUPERADMIN" },
  });
  const admin = await prisma.user.create({
    data: { name: "Admin Pangandaran", email: "admin@reloop.id", phone: "081100000001", passwordHash, role: "ADMIN", organizationId: orgA.id },
  });
  const adminTourism = await prisma.user.create({
    data: { name: "Admin Batu Hiu", email: "admin.batuhiu@reloop.id", phone: "081100000004", passwordHash, role: "ADMIN", organizationId: orgC.id },
  });
  const adminSchool = await prisma.user.create({
    data: { name: "Admin SMAN 1", email: "admin.sman1@reloop.id", phone: "081100000005", passwordHash, role: "ADMIN", organizationId: orgB.id },
  });
  const pengepul = await prisma.user.create({
    data: { name: "Pengepul Sejahtera", email: "pengepul@reloop.id", phone: "081100000002", passwordHash, role: "PENGEPUL" },
  });
  const pengepul2 = await prisma.user.create({
    data: { name: "Pengepul Barokah", email: "pengepul2@reloop.id", phone: "081100000006", passwordHash, role: "PENGEPUL" },
  });
  const user = await prisma.user.create({
    data: { name: "Warga Pangandaran", email: "user@reloop.id", phone: "081100000003", passwordHash, role: "USER" },
  });
  const user2 = await prisma.user.create({
    data: { name: "Siti Aminah", email: "siti@reloop.id", phone: "081100000007", passwordHash, role: "USER" },
  });
  const user3 = await prisma.user.create({
    data: { name: "Eko Prasetyo", email: "eko@reloop.id", phone: "081100000008", passwordHash, role: "USER" },
  });
  const userSuspended = await prisma.user.create({
    data: { name: "Akun Ditangguhkan", email: "suspended@reloop.id", phone: "081100000009", passwordHash, role: "USER", status: "SUSPENDED" },
  });
  const travelAgentOwner = await prisma.user.create({
    data: { name: "Owner Cahaya Tour", email: "cahaya@travel.test", phone: "081177700001", passwordHash, role: "USER" },
  });
  const multiAgentOwner = await prisma.user.create({
    data: { name: "Owner Nusantara Holiday", email: "nusantara@travel.test", phone: "081177700003", passwordHash, role: "USER" },
  });

  // ==========================================================
  // Collector partnerships
  // ==========================================================
  const partnershipActive = await prisma.organizationCollectorPartner.create({
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
  // Second active partnership for orgC
  const partnershipBatuHiu = await prisma.organizationCollectorPartner.create({
    data: {
      organizationId: orgC.id,
      collectorUserId: pengepul2.id,
      status: "ACTIVE",
      serviceAreaJson: { regions: ["Batu Hiu", "Wonoharjo"] },
      contactName: "Pengepul Barokah",
      contactPhone: "081100000006",
      createdByAdminId: adminTourism.id,
      approvedBySuperadminId: superadmin.id,
    },
  });

  // ==========================================================
  // Waste types (global, superadmin-managed)
  // ==========================================================
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

  // ==========================================================
  // Reward rates (global / per item)
  // ==========================================================
  const rateOrganik = await prisma.rewardRate.create({
    data: { wasteTypeId: organik.id, unit: "KG", pointsPerItem: 100, minWeightGrams: 100, maxWeightGrams: 50000, active: true },
  });
  const rateAnorganik = await prisma.rewardRate.create({
    data: { wasteTypeId: anorganik.id, unit: "KG", pointsPerItem: 150, minWeightGrams: 100, maxWeightGrams: 50000, active: true },
  });
  // Campaign-specific boosted rate
  // (will be linked after campaign creation below)

  // ==========================================================
  // Machines
  // ==========================================================
  // Per-machine HMAC ingest secrets (printed below for the simulator).
  const secrets: Record<string, string> = {
    "RLP-001": generateIngestSecret(),
    "RLP-002": generateIngestSecret(),
    "SMA-001": generateIngestSecret(),
    "BTH-001": generateIngestSecret(),
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
  const m4 = await prisma.machine.create({
    data: {
      organizationId: orgC.id, regionId: wonoharjo.id, machineCode: "BTH-001",
      name: "Mesin Batu Hiu", description: "Area parkir wisata Batu Hiu",
      status: "MAINTENANCE", fillLevelPercent: 60, capacityKg: 40,
      hasInputChamber: true, hasConveyor: true, hasCompactor: false, hasExternalCamera: true,
      chamberTimeoutSeconds: 20, qrRotationSeconds: 30,
      ingestSecret: secrets["BTH-001"],
      lastHeartbeatAt: hoursAgo(6), latitude: -7.7012, longitude: 108.6310,
    },
  });

  for (const m of [m1, m2, m3, m4]) {
    await prisma.machineWasteType.createMany({
      data: [
        { machineId: m.id, wasteTypeId: organik.id, active: true },
        { machineId: m.id, wasteTypeId: anorganik.id, active: true },
      ],
    });
  }

  // ==========================================================
  // Campaigns (public + private)
  // ==========================================================
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
  const campaignSchool = await prisma.campaign.create({
    data: {
      organizationId: orgB.id, name: "Bank Sampah Sekolah SMAN 1",
      description: "Program khusus warga sekolah (validasi domain email).",
      campaignType: "SCHOOL_PROGRAM", rewardMode: "MONEY_REWARD", visibility: "PRIVATE",
      allowedEmailDomainsJson: ["@sman1pangandaran.sch.id"], status: "ACTIVE",
      startAt: daysAgo(3), endAt: new Date(Date.now() + 60 * 86_400_000),
    },
  });
  // Draft campaign (not yet started)
  await prisma.campaign.create({
    data: {
      organizationId: orgC.id, name: "Wisata Hijau Batu Hiu",
      description: "Program wisata ramah lingkungan. Sedang dalam persiapan.",
      campaignType: "TOURISM_PROGRAM", rewardMode: "COMPLIANCE_ONLY", visibility: "PUBLIC", status: "DRAFT",
      startAt: new Date(Date.now() + 7 * 86_400_000), endAt: new Date(Date.now() + 90 * 86_400_000),
    },
  });
  // Ended campaign for historical data
  const campaignEnded = await prisma.campaign.create({
    data: {
      organizationId: orgA.id, name: "Bulan Bersih Desember",
      description: "Campaign bulanan yang sudah berakhir.",
      campaignType: "MACHINE_DEPOSIT", rewardMode: "MONEY_REWARD", visibility: "PUBLIC", status: "ENDED",
      startAt: daysAgo(45), endAt: daysAgo(15),
    },
  });

  // Campaign-specific boosted reward rate
  await prisma.rewardRate.create({
    data: { wasteTypeId: anorganik.id, campaignId: campaignPublic.id, organizationId: orgA.id, unit: "KG", pointsPerItem: 200, minWeightGrams: 100, maxWeightGrams: 50000, active: true },
  });

  // ==========================================================
  // Demo tourism compliance
  // ==========================================================
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

  // Non-compliant trip for reporting
  const nonCompliantTrip = await prisma.trip.create({
    data: {
      campaignId: campaignTourism.id,
      travelAgentId: invitedAgent.id,
      travelAgentName: invitedAgent.name,
      userId: travelAgentOwner.id,
      groupName: "Rombongan Pantai Timur",
      leaderName: "Pak Joko",
      leaderContact: "081177700006",
      participantCount: 15,
      status: "COMPLETED",
      complianceStatus: "NON_COMPLIANT",
      complianceScore: 20,
      checkInAt: daysAgo(3),
      checkOutAt: daysAgo(3),
    },
  });
  await prisma.trashBagAssignment.createMany({
    data: [
      { tripId: nonCompliantTrip.id, assignedById: admin.id, bagQrCode: "BAG-DEMO-201", wasteTypeId: organik.id, status: "NOT_RETURNED" },
      { tripId: nonCompliantTrip.id, assignedById: admin.id, bagQrCode: "BAG-DEMO-202", wasteTypeId: anorganik.id, status: "POOR" },
    ],
  });
  await prisma.manualValidation.createMany({
    data: [
      {
        tripId: nonCompliantTrip.id, validatedById: admin.id, validationStage: "CHECK_IN",
        gateType: "ENTRY", appCompleted: true, complianceScore: 30, complianceStatus: "CHECKED_IN",
        createdAt: daysAgo(3),
      },
      {
        tripId: nonCompliantTrip.id, validatedById: admin.id, validationStage: "CHECK_OUT",
        gateType: "EXIT", bagQrCode: "BAG-DEMO-202", returnedBagCount: 1, actualWeightKg: 0.5,
        conditionStatus: "POOR", appCompleted: true, complianceScore: 20, complianceStatus: "NON_COMPLIANT",
        notes: "Trash bag hilang 1, kondisi buruk. Sampah tidak terpilah.",
        createdAt: daysAgo(3),
      },
    ],
  });

  // ==========================================================
  // System config
  // ==========================================================
  await prisma.systemConfig.createMany({
    data: [
      { key: "min_redemption", value: "10000" },
      { key: "default_qr_rotation_seconds", value: "30" },
      { key: "points_to_rupiah", value: "1" },
    ],
  });

  // ==========================================================
  // Deposit sessions & items — User 1 (Warga Pangandaran)
  // ==========================================================
  const sessionA = await prisma.depositSession.create({
    data: {
      userId: user.id, machineId: m1.id, campaignId: campaignPublic.id, status: "COMPLETED",
      startedAt: daysAgo(2), completedAt: new Date(daysAgo(2).getTime() + 600_000),
    },
  });
  const a1 = await prisma.depositItem.create({
    data: { sessionId: sessionA.id, wasteTypeId: organik.id, quantity: 20, measuredWeightGrams: 220, rewardRateId: rateOrganik.id, rewardAmount: 4000, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(2), createdAt: daysAgo(2) },
  });
  const a2 = await prisma.depositItem.create({
    data: { sessionId: sessionA.id, wasteTypeId: anorganik.id, quantity: 16, measuredWeightGrams: 180, rewardRateId: rateAnorganik.id, rewardAmount: 4000, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(2), createdAt: daysAgo(2) },
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
    data: { sessionId: sessionB.id, wasteTypeId: organik.id, quantity: 15, measuredWeightGrams: 260, rewardRateId: rateOrganik.id, rewardAmount: 3000, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(1), createdAt: daysAgo(1) },
  });
  const b2 = await prisma.depositItem.create({
    data: { sessionId: sessionB.id, wasteTypeId: anorganik.id, quantity: 6, measuredWeightGrams: 140, rewardRateId: rateAnorganik.id, rewardAmount: 1500, status: "ACCEPTED", source: "PYTHON_SIMULATOR", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(1), createdAt: daysAgo(1) },
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

  // ==========================================================
  // Deposit sessions — User 2 (Siti Aminah)
  // ==========================================================
  const sessionC = await prisma.depositSession.create({
    data: {
      userId: user2.id, machineId: m3.id, campaignId: campaignSchool.id, status: "COMPLETED",
      startedAt: daysAgo(3), completedAt: new Date(daysAgo(3).getTime() + 400_000),
    },
  });
  const c1 = await prisma.depositItem.create({
    data: { sessionId: sessionC.id, wasteTypeId: organik.id, quantity: 10, measuredWeightGrams: 500, rewardRateId: rateOrganik.id, rewardAmount: 2000, status: "ACCEPTED", source: "MACHINE", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(3), createdAt: daysAgo(3) },
  });
  const c2 = await prisma.depositItem.create({
    data: { sessionId: sessionC.id, wasteTypeId: anorganik.id, quantity: 8, measuredWeightGrams: 350, rewardRateId: rateAnorganik.id, rewardAmount: 2400, status: "ACCEPTED", source: "MACHINE", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(3), createdAt: daysAgo(3) },
  });
  await prisma.rewardLedger.createMany({
    data: [
      { userId: user2.id, organizationId: orgB.id, sessionId: sessionC.id, depositItemId: c1.id, campaignId: campaignSchool.id, entryType: "EARN", amount: 2000, status: "AVAILABLE", reasonCode: "DEPOSIT_ACCEPTED", referenceType: "DepositItem", referenceId: c1.id, createdAt: daysAgo(3) },
      { userId: user2.id, organizationId: orgB.id, sessionId: sessionC.id, depositItemId: c2.id, campaignId: campaignSchool.id, entryType: "EARN", amount: 2400, status: "AVAILABLE", reasonCode: "DEPOSIT_ACCEPTED", referenceType: "DepositItem", referenceId: c2.id, createdAt: daysAgo(3) },
    ],
  });

  // Travel-agent users keep role USER; the link in TravelAgentUser enables the
  // extra points UI. Seed a little wallet activity so the points card is visible.
  await prisma.rewardLedger.createMany({
    data: [
      {
        userId: travelAgentOwner.id,
        organizationId: orgA.id,
        campaignId: campaignTourism.id,
        entryType: "EARN",
        amount: 7800,
        status: "AVAILABLE",
        reasonCode: "TOURISM_COMPLIANCE_BONUS",
        referenceType: "Trip",
        referenceId: tourismTrip.id,
        createdAt: daysAgo(1),
      },
      {
        userId: multiAgentOwner.id,
        organizationId: orgA.id,
        campaignId: campaignTourism.id,
        entryType: "EARN",
        amount: 12500,
        status: "AVAILABLE",
        reasonCode: "TOURISM_COMPLIANCE_BONUS",
        referenceType: "Trip",
        referenceId: completedTourismTrip.id,
        createdAt: daysAgo(1),
      },
    ],
  });

  // ==========================================================
  // Deposit sessions — User 3 (Eko Prasetyo) — multiple sessions
  // ==========================================================
  const sessionD = await prisma.depositSession.create({
    data: {
      userId: user3.id, machineId: m1.id, campaignId: campaignPublic.id, status: "COMPLETED",
      startedAt: daysAgo(5), completedAt: new Date(daysAgo(5).getTime() + 300_000),
    },
  });
  const d1 = await prisma.depositItem.create({
    data: { sessionId: sessionD.id, wasteTypeId: anorganik.id, quantity: 25, measuredWeightGrams: 600, rewardRateId: rateAnorganik.id, rewardAmount: 7500, status: "ACCEPTED", source: "MACHINE", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(5), createdAt: daysAgo(5) },
  });
  await prisma.rewardLedger.create({
    data: { userId: user3.id, organizationId: orgA.id, sessionId: sessionD.id, depositItemId: d1.id, campaignId: campaignPublic.id, entryType: "EARN", amount: 7500, status: "AVAILABLE", reasonCode: "DEPOSIT_ACCEPTED", referenceType: "DepositItem", referenceId: d1.id, createdAt: daysAgo(5) },
  });

  const sessionE = await prisma.depositSession.create({
    data: {
      userId: user3.id, machineId: m2.id, status: "COMPLETED",
      startedAt: daysAgo(4), completedAt: new Date(daysAgo(4).getTime() + 250_000),
    },
  });
  const e1 = await prisma.depositItem.create({
    data: { sessionId: sessionE.id, wasteTypeId: organik.id, quantity: 12, measuredWeightGrams: 400, rewardRateId: rateOrganik.id, rewardAmount: 2400, status: "ACCEPTED", source: "MACHINE", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(4), createdAt: daysAgo(4) },
  });
  await prisma.rewardLedger.create({
    data: { userId: user3.id, organizationId: orgA.id, sessionId: sessionE.id, depositItemId: e1.id, entryType: "EARN", amount: 2400, status: "AVAILABLE", reasonCode: "DEPOSIT_ACCEPTED", referenceType: "DepositItem", referenceId: e1.id, createdAt: daysAgo(4) },
  });

  // Historical session from ended campaign
  const sessionF = await prisma.depositSession.create({
    data: {
      userId: user.id, machineId: m1.id, campaignId: campaignEnded.id, status: "COMPLETED",
      startedAt: daysAgo(20), completedAt: new Date(daysAgo(20).getTime() + 700_000),
    },
  });
  const f1 = await prisma.depositItem.create({
    data: { sessionId: sessionF.id, wasteTypeId: organik.id, quantity: 30, measuredWeightGrams: 800, rewardRateId: rateOrganik.id, rewardAmount: 6000, status: "ACCEPTED", source: "MACHINE", validationReasonCode: "ACCEPTED", acceptedAt: daysAgo(20), createdAt: daysAgo(20) },
  });
  await prisma.rewardLedger.create({
    data: { userId: user.id, organizationId: orgA.id, sessionId: sessionF.id, depositItemId: f1.id, campaignId: campaignEnded.id, entryType: "EARN", amount: 6000, status: "AVAILABLE", reasonCode: "DEPOSIT_ACCEPTED", referenceType: "DepositItem", referenceId: f1.id, createdAt: daysAgo(20) },
  });

  // ==========================================================
  // Payout accounts
  // ==========================================================
  const payoutUser = await prisma.payoutAccount.create({
    data: { userId: user.id, provider: "GOPAY", accountIdentifier: "081100000003", accountName: "Warga Pangandaran", status: "VERIFIED", verifiedAt: daysAgo(10) },
  });
  await prisma.payoutAccount.create({
    data: { userId: user.id, provider: "DANA", accountIdentifier: "081100000003", accountName: "Warga Pangandaran", status: "UNVERIFIED" },
  });
  const payoutUser2 = await prisma.payoutAccount.create({
    data: { userId: user2.id, provider: "LINKAJA", accountIdentifier: "081100000007", accountName: "Siti Aminah", status: "VERIFIED", verifiedAt: daysAgo(5) },
  });
  const payoutUser3 = await prisma.payoutAccount.create({
    data: { userId: user3.id, provider: "OVO", accountIdentifier: "081100000008", accountName: "Eko Prasetyo", status: "VERIFIED", verifiedAt: daysAgo(3) },
  });

  // ==========================================================
  // Redemptions (various lifecycle statuses)
  // ==========================================================
  // 1. Completed redemption (Eko already redeemed Rp5000)
  const redemptionSuccess = await prisma.redemption.create({
    data: {
      userId: user3.id,
      provider: "OVO",
      payoutAccountId: payoutUser3.id,
      amount: 5000,
      method: "MANUAL_TRANSFER",
      status: "SUCCESS",
      manualTransferProofUrl: "/uploads/proof/transfer-eko-001.jpg",
      note: "Transfer manual via OVO berhasil.",
      processedBySuperadminId: superadmin.id,
      idempotencyKey: `redeem-${user3.id}-${Date.now() - 200000}`,
      createdAt: daysAgo(2),
    },
  });
  // Ledger entries for the successful redemption
  await prisma.rewardLedger.createMany({
    data: [
      { userId: user3.id, organizationId: orgA.id, entryType: "REDEEM", amount: -5000, status: "REDEEMED", reasonCode: "REDEMPTION_SUCCESS", referenceType: "Redemption", referenceId: redemptionSuccess.id, createdAt: daysAgo(2) },
    ],
  });

  // 2. Requested redemption (user wants to redeem, pending approval)
  await prisma.redemption.create({
    data: {
      userId: user.id,
      provider: "GOPAY",
      payoutAccountId: payoutUser.id,
      amount: 10000,
      method: "MANUAL_TRANSFER",
      status: "REQUESTED",
      idempotencyKey: `redeem-${user.id}-${Date.now() - 100000}`,
      createdAt: hoursAgo(6),
    },
  });

  // 3. Approved & processing redemption
  await prisma.redemption.create({
    data: {
      userId: user2.id,
      provider: "LINKAJA",
      payoutAccountId: payoutUser2.id,
      amount: 4000,
      method: "MANUAL_TRANSFER",
      status: "PROCESSING",
      note: "Sedang diproses transfer.",
      processedBySuperadminId: superadmin.id,
      idempotencyKey: `redeem-${user2.id}-${Date.now() - 50000}`,
      createdAt: hoursAgo(3),
    },
  });
  // Ledger: reserve for in-flight redemption
  await prisma.rewardLedger.create({
    data: { userId: user2.id, organizationId: orgB.id, entryType: "REDEEM", amount: -4000, status: "PENDING", reasonCode: "REDEMPTION_PROCESSING", referenceType: "Redemption", createdAt: hoursAgo(3) },
  });

  // 4. Failed redemption (for history)
  await prisma.redemption.create({
    data: {
      userId: user3.id,
      provider: "OVO",
      payoutAccountId: payoutUser3.id,
      amount: 3000,
      method: "MANUAL_TRANSFER",
      status: "FAILED",
      note: "Nomor OVO tidak aktif, gagal transfer.",
      processedBySuperadminId: superadmin.id,
      idempotencyKey: `redeem-${user3.id}-${Date.now() - 300000}`,
      createdAt: daysAgo(4),
    },
  });

  // ==========================================================
  // Machine Events (heartbeats, deposit flow, security events)
  // ==========================================================
  let eventCounter = 0;
  const localEvent = (prefix: string) => `${prefix}-${++eventCounter}`;

  // --- Heartbeats (recent) ---
  for (const m of [m1, m2, m3]) {
    for (let i = 0; i < 3; i++) {
      await prisma.machineEvent.create({
        data: {
          machineId: m.id,
          localEventId: localEvent(`HB-${m.machineCode}`),
          eventType: "HEARTBEAT",
          payloadJson: { fillLevelPercent: m.fillLevelPercent, temperature: 28 + i, uptimeMinutes: 1440 - i * 60 },
          occurredAt: minutesAgo(i * 10),
          receivedAt: minutesAgo(i * 10 - 1),
        },
      });
    }
  }

  // --- Deposit flow events for sessionA ---
  await prisma.machineEvent.create({
    data: {
      machineId: m1.id, sessionId: sessionA.id, localEventId: localEvent("SESS-A"),
      eventType: "QR_REFRESHED",
      payloadJson: { sessionId: sessionA.id },
      occurredAt: daysAgo(2), receivedAt: daysAgo(2),
    },
  });
  await prisma.machineEvent.create({
    data: {
      machineId: m1.id, sessionId: sessionA.id, localEventId: localEvent("SESS-A"),
      eventType: "CHAMBER_OPENED",
      payloadJson: { sessionId: sessionA.id },
      occurredAt: new Date(daysAgo(2).getTime() + 5000), receivedAt: new Date(daysAgo(2).getTime() + 5500),
    },
  });
  await prisma.machineEvent.create({
    data: {
      machineId: m1.id, sessionId: sessionA.id, depositItemId: a1.id, localEventId: localEvent("SESS-A"),
      eventType: "ITEM_DETECTED",
      payloadJson: { aiDetectedType: "Organik", aiConfidence: 0.92 },
      occurredAt: new Date(daysAgo(2).getTime() + 10000), receivedAt: new Date(daysAgo(2).getTime() + 10500),
    },
  });
  await prisma.machineEvent.create({
    data: {
      machineId: m1.id, sessionId: sessionA.id, depositItemId: a1.id, localEventId: localEvent("SESS-A"),
      eventType: "WEIGHT_MEASURED",
      payloadJson: { weightGrams: 220 },
      occurredAt: new Date(daysAgo(2).getTime() + 12000), receivedAt: new Date(daysAgo(2).getTime() + 12500),
    },
  });
  await prisma.machineEvent.create({
    data: {
      machineId: m1.id, sessionId: sessionA.id, depositItemId: a1.id, localEventId: localEvent("SESS-A"),
      eventType: "ITEM_ACCEPTED_POINT",
      payloadJson: { rewardAmount: 4000, wasteType: "Organik" },
      occurredAt: new Date(daysAgo(2).getTime() + 15000), receivedAt: new Date(daysAgo(2).getTime() + 15500),
    },
  });
  await prisma.machineEvent.create({
    data: {
      machineId: m1.id, sessionId: sessionA.id, localEventId: localEvent("SESS-A"),
      eventType: "CONVEYOR_STARTED",
      payloadJson: {},
      occurredAt: new Date(daysAgo(2).getTime() + 16000), receivedAt: new Date(daysAgo(2).getTime() + 16500),
    },
  });

  // --- Fill level update for m2 ---
  await prisma.machineEvent.create({
    data: {
      machineId: m2.id, localEventId: localEvent("FILL-M2"),
      eventType: "FILL_LEVEL_UPDATED",
      payloadJson: { previous: 88, current: 95 },
      occurredAt: hoursAgo(4), receivedAt: hoursAgo(4),
    },
  });
  await prisma.machineEvent.create({
    data: {
      machineId: m2.id, localEventId: localEvent("STATUS-M2"),
      eventType: "STATUS_CHANGED",
      payloadJson: { from: "ONLINE", to: "FULL" },
      occurredAt: hoursAgo(4), receivedAt: hoursAgo(4),
    },
  });

  // --- Security events (fraud & vandalism for superadmin dashboard) ---
  await prisma.machineEvent.create({
    data: {
      machineId: m1.id, sessionId: sessionB.id, depositItemId: b3.id,
      localEventId: localEvent("FRAUD-M1"),
      eventType: "FRAUD_DETECTED",
      payloadJson: {
        reason: "WEIGHT_OVER_MAX_OR_STRING_PULL",
        measuredWeightGrams: 90000,
        maxWeightGrams: 50000,
        confidence: 0.97,
      },
      occurredAt: daysAgo(1), receivedAt: daysAgo(1),
    },
  });
  await prisma.machineEvent.create({
    data: {
      machineId: m2.id,
      localEventId: localEvent("VANDAL-M2"),
      eventType: "VANDALISM_DETECTED",
      payloadJson: {
        reason: "REPEATED_IMPACT",
        impactCount: 5,
        durationSeconds: 8,
      },
      occurredAt: hoursAgo(12), receivedAt: hoursAgo(12),
    },
  });
  await prisma.machineEvent.create({
    data: {
      machineId: m2.id,
      localEventId: localEvent("SAFE-M2"),
      eventType: "SAFE_STATE_ENTERED",
      payloadJson: { trigger: "VANDALISM_DETECTED", lockedComponents: ["conveyor", "gate"] },
      occurredAt: hoursAgo(12), receivedAt: hoursAgo(12),
    },
  });
  // Older fraud event for 7-day stats
  await prisma.machineEvent.create({
    data: {
      machineId: m3.id,
      localEventId: localEvent("FRAUD-M3"),
      eventType: "FRAUD_DETECTED",
      payloadJson: { reason: "BARCODE_REUSE", barcodeValue: "8992753112239", reusedCount: 3 },
      occurredAt: daysAgo(5), receivedAt: daysAgo(5),
    },
  });

  // --- Error event for m4 (maintenance machine) ---
  await prisma.machineEvent.create({
    data: {
      machineId: m4.id,
      localEventId: localEvent("ERR-M4"),
      eventType: "ERROR",
      payloadJson: { code: "CONVEYOR_JAM", message: "Motor conveyor macet, perlu perbaikan manual." },
      occurredAt: hoursAgo(6), receivedAt: hoursAgo(6),
    },
  });
  await prisma.machineEvent.create({
    data: {
      machineId: m4.id,
      localEventId: localEvent("STATUS-M4"),
      eventType: "STATUS_CHANGED",
      payloadJson: { from: "ONLINE", to: "MAINTENANCE" },
      occurredAt: hoursAgo(6), receivedAt: hoursAgo(6),
    },
  });

  // ==========================================================
  // Machine Captures (camera snapshots)
  // ==========================================================
  await prisma.machineCapture.create({
    data: {
      machineId: m1.id,
      sessionId: sessionA.id,
      localCaptureId: "cap-m1-001",
      kind: "deposit",
      reason: "item_detected",
      scenePath: `machines/${m1.machineCode}/captures/scene-001.jpg`,
      facePathsJson: [`machines/${m1.machineCode}/captures/face-001-a.jpg`],
      metadataJson: { aiConfidence: 0.92, detectedType: "Organik" },
      faceCount: 1,
      personDetected: true,
      occurredAt: new Date(daysAgo(2).getTime() + 10000),
    },
  });
  await prisma.machineCapture.create({
    data: {
      machineId: m1.id,
      sessionId: sessionA.id,
      localCaptureId: "cap-m1-002",
      kind: "deposit",
      reason: "item_detected",
      scenePath: `machines/${m1.machineCode}/captures/scene-002.jpg`,
      facePathsJson: [`machines/${m1.machineCode}/captures/face-002-a.jpg`],
      metadataJson: { aiConfidence: 0.88, detectedType: "Anorganik" },
      faceCount: 1,
      personDetected: true,
      occurredAt: new Date(daysAgo(2).getTime() + 30000),
    },
  });
  await prisma.machineCapture.create({
    data: {
      machineId: m1.id,
      sessionId: sessionB.id,
      localCaptureId: "cap-m1-003",
      kind: "fraud_alert",
      reason: "weight_anomaly",
      scenePath: `machines/${m1.machineCode}/captures/scene-003.jpg`,
      facePathsJson: [`machines/${m1.machineCode}/captures/face-003-a.jpg`, `machines/${m1.machineCode}/captures/face-003-b.jpg`],
      metadataJson: { fraudType: "WEIGHT_OVER_MAX_OR_STRING_PULL", measuredWeight: 90000 },
      faceCount: 2,
      personDetected: true,
      occurredAt: daysAgo(1),
    },
  });
  await prisma.machineCapture.create({
    data: {
      machineId: m2.id,
      localCaptureId: "cap-m2-001",
      kind: "vandalism_alert",
      reason: "repeated_impact",
      scenePath: `machines/${m2.machineCode}/captures/scene-001.jpg`,
      facePathsJson: [],
      metadataJson: { impactCount: 5, duration: 8 },
      faceCount: 0,
      personDetected: false,
      occurredAt: hoursAgo(12),
    },
  });
  // Routine scheduled capture
  await prisma.machineCapture.create({
    data: {
      machineId: m3.id,
      localCaptureId: "cap-m3-001",
      kind: "scheduled",
      reason: "periodic_snapshot",
      scenePath: `machines/${m3.machineCode}/captures/scene-001.jpg`,
      facePathsJson: [],
      metadataJson: { scheduled: true },
      faceCount: 0,
      personDetected: false,
      occurredAt: hoursAgo(2),
    },
  });

  // ==========================================================
  // Machine Media (display content for kiosk screens)
  // ==========================================================
  await prisma.machineMedia.create({
    data: {
      machineId: m1.id,
      title: "Tutorial Setor Sampah",
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      originalName: "tutorial-setor.mp4",
      storagePath: `machines/${m1.machineCode}/media/tutorial-setor.mp4`,
      fileSize: 15_200_000,
      sha256: createHash("sha256").update("tutorial-setor-demo").digest("hex"),
      durationSeconds: 45,
      sortOrder: 0,
      active: true,
      createdById: admin.id,
    },
  });
  await prisma.machineMedia.create({
    data: {
      machineId: m1.id,
      title: "Promo Gerakan Bersih Pantai",
      mediaType: "IMAGE",
      mimeType: "image/jpeg",
      originalName: "promo-bersih-pantai.jpg",
      storagePath: `machines/${m1.machineCode}/media/promo-bersih-pantai.jpg`,
      fileSize: 850_000,
      sha256: createHash("sha256").update("promo-bersih-demo").digest("hex"),
      durationSeconds: 8,
      sortOrder: 1,
      active: true,
      createdById: admin.id,
    },
  });
  await prisma.machineMedia.create({
    data: {
      machineId: m3.id,
      title: "Info Bank Sampah Sekolah",
      mediaType: "IMAGE",
      mimeType: "image/png",
      originalName: "info-bank-sampah-sekolah.png",
      storagePath: `machines/${m3.machineCode}/media/info-bank-sampah.png`,
      fileSize: 620_000,
      sha256: createHash("sha256").update("info-bank-sampah-demo").digest("hex"),
      durationSeconds: 10,
      sortOrder: 0,
      active: true,
      createdById: adminSchool.id,
    },
  });
  // Inactive media (replaced)
  await prisma.machineMedia.create({
    data: {
      machineId: m1.id,
      title: "Promo Lama (tidak aktif)",
      mediaType: "IMAGE",
      mimeType: "image/jpeg",
      originalName: "promo-lama.jpg",
      storagePath: `machines/${m1.machineCode}/media/promo-lama.jpg`,
      fileSize: 400_000,
      sha256: createHash("sha256").update("promo-lama-demo").digest("hex"),
      durationSeconds: 8,
      sortOrder: 2,
      active: false,
      createdById: admin.id,
    },
  });

  // ==========================================================
  // Machine Remote Commands
  // ==========================================================
  // Succeeded command
  await prisma.machineRemoteCommand.create({
    data: {
      machineId: m1.id,
      requestedById: superadmin.id,
      command: "REFRESH_STATE",
      status: "SUCCEEDED",
      payloadJson: {},
      resultJson: { fillLevelPercent: 35, status: "ONLINE" },
      expiresAt: new Date(hoursAgo(1).getTime() + 60_000),
      dispatchedAt: hoursAgo(1),
      completedAt: new Date(hoursAgo(1).getTime() + 3000),
      createdAt: hoursAgo(1),
    },
  });
  // Queued command (waiting to be dispatched)
  await prisma.machineRemoteCommand.create({
    data: {
      machineId: m2.id,
      requestedById: admin.id,
      command: "CAPTURE_SNAPSHOT",
      status: "QUEUED",
      payloadJson: { reason: "Verifikasi status mesin penuh" },
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: minutesAgo(2),
    },
  });
  // Failed command
  await prisma.machineRemoteCommand.create({
    data: {
      machineId: m4.id,
      requestedById: superadmin.id,
      command: "RESUME_OPERATION",
      status: "FAILED",
      payloadJson: {},
      errorMessage: "Mesin tidak merespon dalam batas waktu. Kemungkinan conveyor masih macet.",
      expiresAt: new Date(hoursAgo(5).getTime() + 60_000),
      dispatchedAt: hoursAgo(5),
      completedAt: new Date(hoursAgo(5).getTime() + 60_000),
      createdAt: hoursAgo(5),
    },
  });
  // Expired command
  await prisma.machineRemoteCommand.create({
    data: {
      machineId: m4.id,
      requestedById: superadmin.id,
      command: "ENTER_MAINTENANCE",
      status: "EXPIRED",
      payloadJson: { reason: "Perlu inspeksi conveyor" },
      expiresAt: hoursAgo(5),
      createdAt: hoursAgo(6),
    },
  });
  // Dispatched command (in progress)
  await prisma.machineRemoteCommand.create({
    data: {
      machineId: m1.id,
      requestedById: admin.id,
      command: "SYNC_NOW",
      status: "DISPATCHED",
      payloadJson: {},
      expiresAt: new Date(Date.now() + 30_000),
      dispatchedAt: minutesAgo(1),
      createdAt: minutesAgo(1),
    },
  });

  // ==========================================================
  // Pickup Requests (multiple lifecycle stages) + Pickup Items
  // ==========================================================
  // 1. Existing: REQUESTED (machine m2 is FULL)
  const pickupRequested = await prisma.pickupRequest.create({
    data: { machineId: m2.id, organizationId: orgA.id, requestedById: admin.id, status: "REQUESTED", reason: "FULL", priority: 1, notes: "Mesin penuh, mohon dijadwalkan pengambilan." },
  });

  // 2. ASSIGNED pickup (pengepul has been assigned)
  const pickupAssigned = await prisma.pickupRequest.create({
    data: {
      machineId: m1.id, organizationId: orgA.id, requestedById: admin.id,
      assignedCollectorId: pengepul.id, collectorPartnerId: partnershipActive.id,
      status: "ASSIGNED", reason: "SCHEDULED", priority: 0,
      notes: "Pengambilan terjadwal mingguan.",
      createdAt: daysAgo(1),
    },
  });

  // 3. COMPLETED pickup with items (historical)
  const pickupCompleted = await prisma.pickupRequest.create({
    data: {
      machineId: m1.id, organizationId: orgA.id, requestedById: admin.id,
      assignedCollectorId: pengepul.id, collectorPartnerId: partnershipActive.id,
      status: "COMPLETED", reason: "FULL", priority: 1,
      notes: "Berhasil diambil dan ditimbang.",
      createdAt: daysAgo(7),
    },
  });
  await prisma.pickupItem.createMany({
    data: [
      {
        pickupRequestId: pickupCompleted.id,
        wasteTypeId: organik.id,
        estimatedWeightKg: 15.0,
        actualWeightKg: 14.2,
        itemCount: 45,
        source: "MANUAL_WEIGHING",
        notes: "Organik dari area pantai.",
      },
      {
        pickupRequestId: pickupCompleted.id,
        wasteTypeId: anorganik.id,
        estimatedWeightKg: 20.0,
        actualWeightKg: 18.5,
        itemCount: 120,
        source: "MACHINE_COUNT",
        notes: "Botol plastik dan kaleng.",
      },
    ],
  });

  // 4. ON_THE_WAY pickup
  const pickupOnTheWay = await prisma.pickupRequest.create({
    data: {
      machineId: m3.id, organizationId: orgB.id, requestedById: adminSchool.id,
      assignedCollectorId: pengepul.id,
      status: "ON_THE_WAY", reason: "MANUAL", priority: 0,
      notes: "Siswa sudah mengumpulkan cukup banyak hari ini.",
      createdAt: hoursAgo(2),
    },
  });

  // 5. CANCELLED pickup
  await prisma.pickupRequest.create({
    data: {
      machineId: m4.id, organizationId: orgC.id, requestedById: adminTourism.id,
      status: "CANCELLED", reason: "ERROR", priority: 0,
      notes: "Dibatalkan karena mesin masih dalam perbaikan.",
      createdAt: daysAgo(2),
    },
  });

  // 6. FAILED pickup
  await prisma.pickupRequest.create({
    data: {
      machineId: m2.id, organizationId: orgA.id, requestedById: admin.id,
      assignedCollectorId: pengepul.id, collectorPartnerId: partnershipActive.id,
      status: "FAILED", reason: "FULL", priority: 1,
      notes: "Kendaraan pengepul mogok di jalan, gagal ambil.",
      createdAt: daysAgo(5),
    },
  });

  // Items for the REQUESTED pickup (estimated from machine count)
  await prisma.pickupItem.createMany({
    data: [
      {
        pickupRequestId: pickupRequested.id,
        wasteTypeId: organik.id,
        estimatedWeightKg: 18.0,
        itemCount: 60,
        source: "MACHINE_COUNT",
      },
      {
        pickupRequestId: pickupRequested.id,
        wasteTypeId: anorganik.id,
        estimatedWeightKg: 25.0,
        itemCount: 150,
        source: "MACHINE_COUNT",
      },
    ],
  });

  // ==========================================================
  // Consent Records
  // ==========================================================
  await prisma.consentRecord.createMany({
    data: [
      { userId: user.id, consentType: "marketing_emails", granted: true, ipAddress: "36.72.100.15", userAgent: "ReLoop-Mobile/1.0 (Android)", createdAt: daysAgo(10) },
      { userId: user.id, consentType: "analytics_tracking", granted: true, ipAddress: "36.72.100.15", userAgent: "ReLoop-Mobile/1.0 (Android)", createdAt: daysAgo(10) },
      { userId: user.id, consentType: "third_party_sharing", granted: false, ipAddress: "36.72.100.15", userAgent: "ReLoop-Mobile/1.0 (Android)", createdAt: daysAgo(10) },
      { userId: user2.id, consentType: "marketing_emails", granted: true, ipAddress: "36.72.100.20", userAgent: "ReLoop-Mobile/1.0 (iOS)", createdAt: daysAgo(5) },
      { userId: user2.id, consentType: "analytics_tracking", granted: true, ipAddress: "36.72.100.20", userAgent: "ReLoop-Mobile/1.0 (iOS)", createdAt: daysAgo(5) },
      { userId: user3.id, consentType: "marketing_emails", granted: false, ipAddress: "36.72.100.25", userAgent: "Mozilla/5.0", createdAt: daysAgo(3) },
      { userId: user3.id, consentType: "analytics_tracking", granted: true, ipAddress: "36.72.100.25", userAgent: "Mozilla/5.0", createdAt: daysAgo(3) },
      { userId: user3.id, consentType: "profiling", granted: false, ipAddress: "36.72.100.25", userAgent: "Mozilla/5.0", createdAt: daysAgo(3) },
      // Consent withdrawal example
      { userId: user.id, consentType: "marketing_emails", granted: false, ipAddress: "36.72.100.15", userAgent: "ReLoop-Mobile/1.0 (Android)", createdAt: daysAgo(2) },
    ],
  });

  // ==========================================================
  // Audit Logs (chained checksums — must be in chronological order)
  // ==========================================================
  await seedAuditLog({
    actorId: superadmin.id,
    action: "USER_CREATED",
    entityType: "User",
    entityId: admin.id,
    metadata: { email: "admin@reloop.id", role: "ADMIN" },
    createdAt: daysAgo(30),
  });
  await seedAuditLog({
    actorId: superadmin.id,
    action: "ORGANIZATION_CREATED",
    entityType: "Organization",
    entityId: orgA.id,
    metadata: { name: "Bank Sampah Pangandaran", type: "WASTE_BANK" },
    createdAt: daysAgo(30),
  });
  await seedAuditLog({
    actorId: superadmin.id,
    action: "MACHINE_PROVISIONED",
    entityType: "Machine",
    entityId: m1.id,
    metadata: { machineCode: "RLP-001", organizationName: "Bank Sampah Pangandaran" },
    createdAt: daysAgo(28),
  });
  await seedAuditLog({
    actorId: superadmin.id,
    action: "PARTNERSHIP_APPROVED",
    entityType: "OrganizationCollectorPartner",
    entityId: partnershipActive.id,
    metadata: { collectorName: "Pengepul Sejahtera", organizationName: "Bank Sampah Pangandaran" },
    createdAt: daysAgo(25),
  });
  await seedAuditLog({
    actorId: admin.id,
    action: "CAMPAIGN_CREATED",
    entityType: "Campaign",
    entityId: campaignPublic.id,
    metadata: { name: "Gerakan Bersih Pantai", type: "MACHINE_DEPOSIT" },
    createdAt: daysAgo(7),
  });
  await seedAuditLog({
    actorId: null,
    action: "DEPOSIT_COMPLETED",
    entityType: "DepositSession",
    entityId: sessionA.id,
    metadata: { userId: user.id, machineCode: "RLP-001", itemCount: 2, totalReward: 8000 },
    createdAt: daysAgo(2),
  });
  await seedAuditLog({
    actorId: user.id,
    action: "CONSENT_GIVEN",
    entityType: "ConsentRecord",
    metadata: { consentType: "marketing_emails", granted: true },
    createdAt: daysAgo(10),
  });
  await seedAuditLog({
    actorId: user.id,
    action: "CONSENT_WITHDRAWN",
    entityType: "ConsentRecord",
    metadata: { consentType: "marketing_emails", granted: false },
    createdAt: daysAgo(2),
  });
  await seedAuditLog({
    actorId: null,
    action: "FRAUD_DETECTED",
    entityType: "MachineEvent",
    metadata: { machineCode: "RLP-001", reason: "WEIGHT_OVER_MAX_OR_STRING_PULL", sessionId: sessionB.id },
    createdAt: daysAgo(1),
  });
  await seedAuditLog({
    actorId: superadmin.id,
    action: "REDEMPTION_SUCCESS",
    entityType: "Redemption",
    entityId: redemptionSuccess.id,
    metadata: { userId: user3.id, amount: 5000, provider: "OVO" },
    createdAt: daysAgo(2),
  });
  await seedAuditLog({
    actorId: user.id,
    action: "REDEMPTION_REQUEST",
    entityType: "Redemption",
    metadata: { amount: 10000, provider: "GOPAY" },
    createdAt: hoursAgo(6),
  });
  await seedAuditLog({
    actorId: admin.id,
    action: "PICKUP_CREATED",
    entityType: "PickupRequest",
    entityId: pickupRequested.id,
    metadata: { machineCode: "RLP-002", reason: "FULL" },
    createdAt: new Date(),
  });
  await seedAuditLog({
    actorId: superadmin.id,
    action: "REMOTE_COMMAND_ISSUED",
    entityType: "Machine",
    entityId: m1.id,
    metadata: { command: "REFRESH_STATE", machineCode: "RLP-001" },
    createdAt: hoursAgo(1),
  });
  await seedAuditLog({
    actorId: superadmin.id,
    action: "USER_SUSPENDED",
    entityType: "User",
    entityId: userSuspended.id,
    metadata: { email: "suspended@reloop.id", reason: "Pelanggaran berulang" },
    createdAt: daysAgo(1),
  });

  // ==========================================================
  // Summary
  // ==========================================================
  console.log("\nSeed complete!");
  console.log("Demo accounts (password: password123):");
  console.log("  superadmin@reloop.id      (SUPERADMIN)");
  console.log("  admin@reloop.id           (ADMIN - Bank Sampah Pangandaran)");
  console.log("  admin.batuhiu@reloop.id   (ADMIN - Pantai Batu Hiu)");
  console.log("  admin.sman1@reloop.id     (ADMIN - SMAN 1 Pangandaran)");
  console.log("  pengepul@reloop.id        (PENGEPUL - active partner of org A)");
  console.log("  pengepul2@reloop.id       (PENGEPUL - active partner of org C)");
  console.log("  user@reloop.id            (USER - balance ~Rp18.700, Rp200 pending, Rp10k redemption requested)");
  console.log("  siti@reloop.id            (USER - balance Rp4.400, Rp4k redemption processing)");
  console.log("  eko@reloop.id             (USER - balance Rp4.900, Rp5k redeemed successfully)");
  console.log("  suspended@reloop.id       (USER - SUSPENDED)");
  console.log("  cahaya@travel.test        (USER - Travel Agent INVITED, points visible)");
  console.log("  nusantara@travel.test     (USER - Travel Agent multi-tempat wisata, points visible)");
  console.log("  pending.agent@travel.test belum punya akun, status seed = PENDING");
  console.log("\nMachines: RLP-001 (ONLINE), RLP-002 (FULL), SMA-001 (ONLINE), BTH-001 (MAINTENANCE)");
  console.log("\nPer-machine ingest secrets (for the Python simulator):");
  for (const [codeName, sec] of Object.entries(secrets)) {
    console.log(`  ${codeName}: ${sec}`);
  }
  console.log(
    "\nSimulate (signed handshake):\n" +
      '  python simulator/simulator.py -m RLP-001 --secret "<SECRET RLP-001>"\n',
  );
  console.log("Seeded models:");
  console.log("  ✓ Region, Organization, User, OrganizationCollectorPartner");
  console.log("  ✓ WasteType, MachineWasteType, RewardRate, Machine");
  console.log("  ✓ Campaign (active, draft, ended)");
  console.log("  ✓ DepositSession, DepositItem, RewardLedger");
  console.log("  ✓ MachineEvent (heartbeat, deposit flow, security, status)");
  console.log("  ✓ MachineCapture (deposit, fraud, vandalism, scheduled)");
  console.log("  ✓ MachineMedia (video, image, inactive)");
  console.log("  ✓ MachineRemoteCommand (queued, dispatched, succeeded, failed, expired)");
  console.log("  ✓ PayoutAccount, Redemption (requested, processing, success, failed)");
  console.log("  ✓ PickupRequest (requested, assigned, on_the_way, completed, cancelled, failed)");
  console.log("  ✓ PickupItem");
  console.log("  ✓ TravelAgent, TravelAgentOrganization, TravelAgentInvite, TravelAgentUser");
  console.log("  ✓ Trip, TrashBagAssignment, ManualValidation (compliant, non-compliant)");
  console.log("  ✓ AuditLog (chained checksums)");
  console.log("  ✓ ConsentRecord");
  console.log("  ✓ SystemConfig");
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
