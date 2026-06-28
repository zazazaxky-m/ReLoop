// Data models mirroring Prisma schema and API responses
export 'models/trip.dart';
enum AppRole { USER, PENGEPUL, ADMIN, SUPERADMIN }

extension AppRoleX on AppRole {
  String get apiValue {
    switch (this) {
      case AppRole.USER: return 'USER';
      case AppRole.PENGEPUL: return 'PENGEPUL';
      case AppRole.ADMIN: return 'ADMIN';
      case AppRole.SUPERADMIN: return 'SUPERADMIN';
    }
  }

  String get label {
    switch (this) {
      case AppRole.USER: return 'User';
      case AppRole.PENGEPUL: return 'Pengepul';
      case AppRole.ADMIN: return 'Admin';
      case AppRole.SUPERADMIN: return 'Superadmin';
    }
  }

  static AppRole fromString(String role) {
    switch (role) {
      case 'USER': return AppRole.USER;
      case 'PENGEPUL': return AppRole.PENGEPUL;
      case 'ADMIN': return AppRole.ADMIN;
      case 'SUPERADMIN': return AppRole.SUPERADMIN;
      default: return AppRole.USER;
    }
  }
}

class CurrentUser {
  final String id;
  final String name;
  final String email;
  final String? phone;
  final AppRole role;
  final String? organizationId;
  final String? organizationName;
  final bool payoutEligible;
  final String status;

  CurrentUser({
    required this.id,
    required this.name,
    required this.email,
    this.phone,
    required this.role,
    this.organizationId,
    this.organizationName,
    this.payoutEligible = false,
    this.status = 'ACTIVE',
  });

  factory CurrentUser.fromJson(Map<String, dynamic> json) {
    return CurrentUser(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
      email: (json['email'] as String?) ?? '',
      phone: json['phone'] as String?,
      role: AppRoleX.fromString(json['role'] as String),
      organizationId: json['organizationId'] as String?,
      organizationName: json['organizationName'] as String?,
      payoutEligible: json['payoutEligible'] as bool? ?? false,
      status: json['status'] as String? ?? 'ACTIVE',
    );
  }
}

class WalletBalance {
  final int available;
  final int pending;
  final int redeemed;
  final int reserved;
  final int totalEarned;

  WalletBalance({
    required this.available,
    required this.pending,
    required this.redeemed,
    required this.reserved,
    required this.totalEarned,
  });

  factory WalletBalance.fromJson(Map<String, dynamic> json) {
    return WalletBalance(
      available: (json['available'] as num?)?.toInt() ?? 0,
      pending: (json['pending'] as num?)?.toInt() ?? 0,
      redeemed: (json['redeemed'] as num?)?.toInt() ?? 0,
      reserved: (json['reserved'] as num?)?.toInt() ?? 0,
      totalEarned: (json['totalEarned'] as num?)?.toInt() ?? 0,
    );
  }

  String get availableFormatted => 'Rp ${_format(available)}';
  String get pendingFormatted => 'Rp ${_format(pending)}';
  String get totalEarnedFormatted => 'Rp ${_format(totalEarned)}';

  static String _format(int amount) {
    return amount.toString().replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]}.',
    );
  }
}

class DepositSession {
  final String id;
  final String userId;
  final String machineId;
  final String? campaignId;
  final String status;
  final String startedAt;
  final String? completedAt;
  final String? timeoutAt;
  final int anomalyCount;
  final MachineInfo? machine;
  final CampaignInfo? campaign;
  final List<DepositItem>? items;

  DepositSession({
    required this.id,
    required this.userId,
    required this.machineId,
    this.campaignId,
    required this.status,
    required this.startedAt,
    this.completedAt,
    this.timeoutAt,
    this.anomalyCount = 0,
    this.machine,
    this.campaign,
    this.items,
  });

  factory DepositSession.fromJson(Map<String, dynamic> json) {
    return DepositSession(
      id: (json['id'] as String?) ?? '',
      userId: (json['userId'] as String?) ?? '',
      machineId: (json['machineId'] as String?) ?? '',
      campaignId: json['campaignId'] as String?,
      status: json['status'] as String? ?? 'ACTIVE',
      startedAt: json['startedAt'] as String? ?? '',
      completedAt: json['completedAt'] as String?,
      timeoutAt: json['timeoutAt'] as String?,
      anomalyCount: (json['anomalyCount'] as num?)?.toInt() ?? 0,
      machine: json['machine'] != null
          ? MachineInfo.fromJson(json['machine'] as Map<String, dynamic>)
          : null,
      campaign: json['campaign'] != null
          ? CampaignInfo.fromJson(json['campaign'] as Map<String, dynamic>)
          : null,
      items: json['items'] != null
          ? (json['items'] as List)
              .map((e) => DepositItem.fromJson(e as Map<String, dynamic>))
              .toList()
          : null,
    );
  }
}

class MachineInfo {
  final String id;
  final String machineCode;
  final String name;
  final String? organizationId;
  final String? organizationName;
  final String status;
  final int fillLevelPercent;
  final double? latitude;
  final double? longitude;
  final List<WasteTypeRef>? supportedWasteTypes;

  MachineInfo({
    required this.id,
    required this.machineCode,
    required this.name,
    this.organizationId,
    this.organizationName,
    this.status = 'OFFLINE',
    this.fillLevelPercent = 0,
    this.latitude,
    this.longitude,
    this.supportedWasteTypes,
  });

  factory MachineInfo.fromJson(Map<String, dynamic> json) {
    return MachineInfo(
      id: (json['id'] as String?) ?? '',
      machineCode: (json['machineCode'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
      organizationId: json['organizationId'] as String?,
      organizationName: json['organizationName'] as String? ??
          (json['organization']?['name'] as String?),
      status: json['status'] as String? ?? 'OFFLINE',
      fillLevelPercent: (json['fillLevelPercent'] as num?)?.toInt() ?? 0,
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      supportedWasteTypes: json['supportedWasteTypes'] != null
          ? (json['supportedWasteTypes'] as List)
              .map((e) => WasteTypeRef.fromJson(e as Map<String, dynamic>))
              .toList()
          : null,
    );
  }
}

class WasteTypeRef {
  final String id;
  final String name;

  WasteTypeRef({required this.id, required this.name});

  factory WasteTypeRef.fromJson(Map<String, dynamic> json) {
    return WasteTypeRef(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
    );
  }
}

class DepositItem {
  final String id;
  final String sessionId;
  final String? wasteTypeId;
  final int quantity;
  final int? measuredWeightGrams;
  final String? aiDetectedType;
  final double? aiConfidence;
  final int? rewardAmount;
  final String status;
  final String source;
  final WasteTypeRef? wasteType;

  DepositItem({
    required this.id,
    required this.sessionId,
    this.wasteTypeId,
    this.quantity = 1,
    this.measuredWeightGrams,
    this.aiDetectedType,
    this.aiConfidence,
    this.rewardAmount,
    this.status = 'PENDING',
    this.source = 'MACHINE',
    this.wasteType,
  });

  factory DepositItem.fromJson(Map<String, dynamic> json) {
    return DepositItem(
      id: (json['id'] as String?) ?? '',
      sessionId: (json['sessionId'] as String?) ?? '',
      wasteTypeId: json['wasteTypeId'] as String?,
      quantity: (json['quantity'] as num?)?.toInt() ?? 1,
      measuredWeightGrams: (json['measuredWeightGrams'] as num?)?.toInt(),
      aiDetectedType: json['aiDetectedType'] as String?,
      aiConfidence: (json['aiConfidence'] as num?)?.toDouble(),
      rewardAmount: (json['rewardAmount'] as num?)?.toInt(),
      status: json['status'] as String? ?? 'PENDING',
      source: json['source'] as String? ?? 'MACHINE',
      wasteType: json['wasteType'] != null
          ? WasteTypeRef.fromJson(json['wasteType'] as Map<String, dynamic>)
          : null,
    );
  }
}

class CampaignInfo {
  final String id;
  final String name;
  final String? description;
  final String campaignType;
  final String visibility;
  final String status;
  final String? organizationId;
  final String? organizationName;
  final DateTime? startAt;
  final DateTime? endAt;
  final List<String>? allowedEmailDomains;
  final double? rewardMultiplier;

  CampaignInfo({
    required this.id,
    required this.name,
    this.description,
    this.campaignType = 'MACHINE_DEPOSIT',
    this.visibility = 'PUBLIC',
    this.status = 'DRAFT',
    this.organizationId,
    this.organizationName,
    this.startAt,
    this.endAt,
    this.allowedEmailDomains,
    this.rewardMultiplier,
  });

  factory CampaignInfo.fromJson(Map<String, dynamic> json) {
    return CampaignInfo(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
      description: json['description'] as String?,
      campaignType: json['campaignType'] as String? ?? 'MACHINE_DEPOSIT',
      visibility: json['visibility'] as String? ?? 'PUBLIC',
      status: json['status'] as String? ?? 'DRAFT',
      organizationId: json['organizationId'] as String?,
      organizationName: json['organization']?['name'] as String?,
      startAt: json['startAt'] != null ? DateTime.tryParse(json['startAt'] as String) : null,
      endAt: json['endAt'] != null ? DateTime.tryParse(json['endAt'] as String) : null,
      allowedEmailDomains: (json['allowedEmailDomains'] as List<dynamic>?)?.cast<String>(),
      rewardMultiplier: (json['rewardMultiplier'] as num?)?.toDouble(),
    );
  }
}

class RewardLedgerEntry {
  final String id;
  final String userId;
  final String? sessionId;
  final String? depositItemId;
  final String? campaignId;
  final String entryType;
  final int amount;
  final String status;
  final String? reasonCode;
  final String createdAt;
  final String? wasteTypeName;
  final String? machineName;

  RewardLedgerEntry({
    required this.id,
    required this.userId,
    this.sessionId,
    this.depositItemId,
    this.campaignId,
    required this.entryType,
    required this.amount,
    required this.status,
    this.reasonCode,
    required this.createdAt,
    this.wasteTypeName,
    this.machineName,
  });

  factory RewardLedgerEntry.fromJson(Map<String, dynamic> json) {
    return RewardLedgerEntry(
      id: (json['id'] as String?) ?? '',
      userId: (json['userId'] as String?) ?? '',
      sessionId: json['sessionId'] as String?,
      depositItemId: json['depositItemId'] as String?,
      campaignId: json['campaignId'] as String?,
      entryType: json['entryType'] as String? ?? 'EARN',
      amount: (json['amount'] as num?)?.toInt() ?? 0,
      status: json['status'] as String? ?? 'AVAILABLE',
      reasonCode: json['reasonCode'] as String?,
      createdAt: json['createdAt'] as String? ?? '',
      wasteTypeName: json['depositItem']?['wasteType']?['name'] as String?,
      machineName: json['session']?['machine']?['name'] as String?,
    );
  }
}

class ScanResult {
  final DepositSession session;
  final MachineInfo machine;
  final bool resumed;

  ScanResult({
    required this.session,
    required this.machine,
    this.resumed = false,
  });

  factory ScanResult.fromJson(Map<String, dynamic> json) {
    return ScanResult(
      session: DepositSession.fromJson(json['session'] as Map<String, dynamic>),
      machine: MachineInfo.fromJson(json['machine'] as Map<String, dynamic>),
      resumed: json['resumed'] as bool? ?? false,
    );
  }
}

class UserDashboard {
  final WalletBalance balance;
  final List<DepositSession> recentSessions;
  final List<CampaignInfo> campaigns;
  final List<RewardLedgerEntry> recentLedger;

  UserDashboard({
    required this.balance,
    required this.recentSessions,
    required this.campaigns,
    required this.recentLedger,
  });

  factory UserDashboard.fromJson(Map<String, dynamic> json) {
    final balanceData = json['balance'];
    if (balanceData == null) throw Exception('Dashboard missing "balance" field');
    return UserDashboard(
      balance: WalletBalance.fromJson(balanceData as Map<String, dynamic>),
      recentSessions: (json['recentSessions'] as List? ?? [])
          .map((e) => DepositSession.fromJson(e as Map<String, dynamic>))
          .toList(),
      campaigns: (json['campaigns'] as List? ?? [])
          .map((e) => CampaignInfo.fromJson(e as Map<String, dynamic>))
          .toList(),
      recentLedger: (json['recentLedger'] as List? ?? [])
          .map((e) => RewardLedgerEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

class PayoutAccount {
  final String id;
  final String provider;
  final String accountIdentifier;
  final String? accountName;
  final String status;

  PayoutAccount({
    required this.id,
    required this.provider,
    required this.accountIdentifier,
    this.accountName,
    this.status = 'UNVERIFIED',
  });

  factory PayoutAccount.fromJson(Map<String, dynamic> json) {
    return PayoutAccount(
      id: json['id'] as String,
      provider: json['provider'] as String,
      accountIdentifier: json['accountIdentifier'] as String,
      accountName: json['accountName'] as String?,
      status: json['status'] as String? ?? 'UNVERIFIED',
    );
  }
}
