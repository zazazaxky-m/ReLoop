class TrashBag {
  final String id;
  final String userId;
  final String? wasteTypeId;
  final String? wasteTypeName;
  final int quantity;
  final String status;
  final String? notes;
  final String? photoUrl;
  final String? adminNote;
  final String createdAt;
  final String? processedAt;

  TrashBag({
    required this.id,
    required this.userId,
    this.wasteTypeId,
    this.wasteTypeName,
    this.quantity = 1,
    required this.status,
    this.notes,
    this.photoUrl,
    this.adminNote,
    required this.createdAt,
    this.processedAt,
  });

  factory TrashBag.fromJson(Map<String, dynamic> json) {
    return TrashBag(
      id: json['id'] as String,
      userId: json['userId'] as String,
      wasteTypeId: json['wasteTypeId'] as String?,
      wasteTypeName: json['wasteType'] != null
          ? (json['wasteType'] as Map<String, dynamic>)['name'] as String?
          : null,
      quantity: (json['quantity'] as num?)?.toInt() ?? 1,
      status: json['status'] as String? ?? 'PENDING',
      notes: json['notes'] as String?,
      photoUrl: json['photoUrl'] as String?,
      adminNote: json['adminNote'] as String?,
      createdAt: json['createdAt'] as String? ?? '',
      processedAt: json['processedAt'] as String?,
    );
  }

  String get statusLabel {
    switch (status) {
      case 'PENDING':
        return 'Menunggu Verifikasi';
      case 'APPROVED':
        return 'Disetujui';
      case 'REJECTED':
        return 'Ditolak';
      case 'COMPLETED':
        return 'Selesai';
      default:
        return status;
    }
  }

  String get statusTone {
    switch (status) {
      case 'PENDING':
        return 'warning';
      case 'APPROVED':
        return 'brand';
      case 'COMPLETED':
        return 'success';
      case 'REJECTED':
        return 'danger';
      default:
        return 'neutral';
    }
  }
}

class WasteType {
  final String id;
  final String name;
  final String? unit;
  final int? rewardPerKg;

  WasteType({
    required this.id,
    required this.name,
    this.unit,
    this.rewardPerKg,
  });

  factory WasteType.fromJson(Map<String, dynamic> json) {
    return WasteType(
      id: json['id'] as String,
      name: json['name'] as String,
      unit: json['unit'] as String?,
      rewardPerKg: (json['rewardPerKg'] as num?)?.toInt(),
    );
  }
}
