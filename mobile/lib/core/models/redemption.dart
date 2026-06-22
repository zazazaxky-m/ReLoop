class Redemption {
  final String id;
  final int amount;
  final String provider;
  final String? accountIdentifier;
  final String? accountName;
  final String status;
  final String? note;
  final String createdAt;
  final String? processedAt;

  Redemption({
    required this.id,
    required this.amount,
    required this.provider,
    this.accountIdentifier,
    this.accountName,
    required this.status,
    this.note,
    required this.createdAt,
    this.processedAt,
  });

  factory Redemption.fromJson(Map<String, dynamic> json) {
    return Redemption(
      id: json['id'] as String,
      amount: (json['amount'] as num?)?.toInt() ?? 0,
      provider: json['provider'] as String? ?? '',
      accountIdentifier: json['accountIdentifier'] as String?,
      accountName: json['accountName'] as String?,
      status: json['status'] as String? ?? 'REQUESTED',
      note: json['note'] as String?,
      createdAt: json['createdAt'] as String? ?? '',
      processedAt: json['processedAt'] as String?,
    );
  }

  String get statusLabel {
    switch (status) {
      case 'REQUESTED':
      case 'PENDING':
        return 'Menunggu';
      case 'APPROVED':
        return 'Disetujui';
      case 'PROCESSING':
        return 'Diproses';
      case 'SUCCESS':
      case 'COMPLETED':
        return 'Selesai';
      case 'FAILED':
        return 'Gagal';
      case 'REJECTED':
        return 'Ditolak';
      case 'CANCELLED':
        return 'Dibatalkan';
      default:
        return status;
    }
  }

  String get amountFormatted {
    return 'Rp ${amount.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]}.')}';
  }
}

class PayoutAccountModel {
  final String id;
  final String provider;
  final String accountIdentifier;
  final String? accountName;
  final String status;
  final bool isDefault;

  PayoutAccountModel({
    required this.id,
    required this.provider,
    required this.accountIdentifier,
    this.accountName,
    this.status = 'UNVERIFIED',
    this.isDefault = false,
  });

  factory PayoutAccountModel.fromJson(Map<String, dynamic> json) {
    return PayoutAccountModel(
      id: json['id'] as String,
      provider: json['provider'] as String,
      accountIdentifier: json['accountIdentifier'] as String,
      accountName: json['accountName'] as String?,
      status: json['status'] as String? ?? 'UNVERIFIED',
      isDefault: json['isDefault'] as bool? ?? false,
    );
  }
}
