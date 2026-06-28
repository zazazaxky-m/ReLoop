class Trip {
  final String id;
  final String campaignId;
  final String? groupName;
  final String? leaderName;
  final int participantCount;
  final String status;
  final String createdAt;
  final CampaignBasic? campaign;
  final TripCounts? count;

  Trip({
    required this.id,
    required this.campaignId,
    this.groupName,
    this.leaderName,
    required this.participantCount,
    required this.status,
    required this.createdAt,
    this.campaign,
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
      createdAt: json['createdAt'] as String? ?? '',
      campaign: json['campaign'] != null ? CampaignBasic.fromJson(json['campaign'] as Map<String, dynamic>) : null,
      count: json['_count'] != null ? TripCounts.fromJson(json['_count'] as Map<String, dynamic>) : null,
    );
  }
}

class CampaignBasic {
  final String id;
  final String name;
  final String organizationId;

  CampaignBasic({
    required this.id,
    required this.name,
    required this.organizationId,
  });

  factory CampaignBasic.fromJson(Map<String, dynamic> json) {
    return CampaignBasic(
      id: json['id'] as String,
      name: json['name'] as String,
      organizationId: json['organizationId'] as String,
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
