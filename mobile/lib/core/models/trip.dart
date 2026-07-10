class Trip {
  final String id;
  final String campaignId;
  final String? groupName;
  final String? leaderName;
  final int participantCount;
  final String status;
  final String? complianceStatus;
  final int complianceScore;
  final String createdAt;
  final CampaignBasic? campaign;
  final TripUser? user;
  final TripCounts? count;

  Trip({
    required this.id,
    required this.campaignId,
    this.groupName,
    this.leaderName,
    required this.participantCount,
    required this.status,
    this.complianceStatus,
    this.complianceScore = 0,
    required this.createdAt,
    this.campaign,
    this.user,
    this.count,
  });

  factory Trip.fromJson(Map<String, dynamic> json) {
    return Trip(
      id: json['id'] as String,
      campaignId: json['campaignId'] as String,
      groupName: json['groupName'] as String?,
      leaderName: json['leaderName'] as String?,
      participantCount: (json['participantCount'] as num?)?.toInt() ?? 1,
      status: json['status'] as String? ?? 'PLANNED',
      complianceStatus: json['complianceStatus'] as String?,
      complianceScore: (json['complianceScore'] as num?)?.toInt() ?? 0,
      createdAt: json['createdAt'] as String? ?? '',
      campaign: json['campaign'] != null
          ? CampaignBasic.fromJson(json['campaign'] as Map<String, dynamic>)
          : null,
      user: json['user'] != null
          ? TripUser.fromJson(json['user'] as Map<String, dynamic>)
          : null,
      count: json['_count'] != null
          ? TripCounts.fromJson(json['_count'] as Map<String, dynamic>)
          : null,
    );
  }
}

class CampaignBasic {
  final String id;
  final String name;
  final String organizationId;
  final String? rewardMode;
  final String? campaignType;

  CampaignBasic({
    required this.id,
    required this.name,
    required this.organizationId,
    this.rewardMode,
    this.campaignType,
  });

  factory CampaignBasic.fromJson(Map<String, dynamic> json) {
    return CampaignBasic(
      id: json['id'] as String,
      name: json['name'] as String,
      organizationId: json['organizationId'] as String? ?? '',
      rewardMode: json['rewardMode'] as String?,
      campaignType: json['campaignType'] as String?,
    );
  }
}

class TripUser {
  final String id;
  final String? name;
  final String? email;

  TripUser({required this.id, this.name, this.email});

  factory TripUser.fromJson(Map<String, dynamic> json) {
    return TripUser(
      id: json['id'] as String,
      name: json['name'] as String?,
      email: json['email'] as String?,
    );
  }
}

class TripCounts {
  final int bagAssignments;
  final int validations;

  TripCounts({
    this.bagAssignments = 0,
    this.validations = 0,
  });

  factory TripCounts.fromJson(Map<String, dynamic> json) {
    return TripCounts(
      bagAssignments: (json['bagAssignments'] as num?)?.toInt() ?? 0,
      validations: (json['validations'] as num?)?.toInt() ?? 0,
    );
  }
}
