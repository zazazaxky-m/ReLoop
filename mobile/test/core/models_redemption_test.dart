import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/models/redemption.dart';

void main() {
  group('Redemption', () {
    final json = {
      'id': 'red-1',
      'amount': 50000,
      'provider': 'BANK',
      'accountIdentifier': '1234567890',
      'accountName': 'Test User',
      'status': 'PENDING',
      'createdAt': '2024-01-01T00:00:00Z',
    };

    test('fromJson parses correctly', () {
      final r = Redemption.fromJson(json);

      expect(r.id, 'red-1');
      expect(r.amount, 50000);
      expect(r.provider, 'BANK');
      expect(r.status, 'PENDING');
    });

    test('amountFormatted formats correctly', () {
      final r = Redemption.fromJson(json);
      expect(r.amountFormatted, 'Rp 50.000');
    });

    test('statusLabel returns correct labels', () {
      expect(Redemption.fromJson({...json, 'status': 'PENDING'}).statusLabel, 'Menunggu');
      expect(Redemption.fromJson({...json, 'status': 'PROCESSING'}).statusLabel, 'Diproses');
      expect(Redemption.fromJson({...json, 'status': 'COMPLETED'}).statusLabel, 'Selesai');
      expect(Redemption.fromJson({...json, 'status': 'REJECTED'}).statusLabel, 'Ditolak');
      expect(Redemption.fromJson({...json, 'status': 'CANCELLED'}).statusLabel, 'Dibatalkan');
    });

    test('fromJson handles missing optional fields', () {
      final r = Redemption.fromJson({
        'id': 'r1',
        'amount': 1000,
        'provider': 'DANA',
        'status': 'PENDING',
        'createdAt': '2024-01-01',
      });
      expect(r.accountName, isNull);
      expect(r.processedAt, isNull);
    });
  });

  group('PayoutAccountModel', () {
    test('fromJson parses correctly', () {
      final json = {
        'id': 'pa-1',
        'provider': 'GOPAY',
        'accountIdentifier': '08123456789',
        'accountName': 'User Name',
        'status': 'VERIFIED',
        'isDefault': true,
      };

      final pa = PayoutAccountModel.fromJson(json);
      expect(pa.id, 'pa-1');
      expect(pa.provider, 'GOPAY');
      expect(pa.status, 'VERIFIED');
      expect(pa.isDefault, true);
    });

    test('fromJson has sensible defaults', () {
      final json = {
        'id': 'pa-1',
        'provider': 'OVO',
        'accountIdentifier': '08111111111',
      };
      final pa = PayoutAccountModel.fromJson(json);
      expect(pa.status, 'UNVERIFIED');
      expect(pa.isDefault, false);
      expect(pa.accountName, isNull);
    });
  });
}
