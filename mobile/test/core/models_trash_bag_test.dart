import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/models/trash_bag.dart';

void main() {
  group('TrashBag', () {
    final baseJson = {
      'id': 'tb-1',
      'userId': 'user-1',
      'wasteTypeId': 'wt-1',
      'quantity': 3,
      'status': 'PENDING',
      'createdAt': '2024-01-01T00:00:00Z',
    };

    test('fromJson parses correctly', () {
      final bag = TrashBag.fromJson(baseJson);

      expect(bag.id, 'tb-1');
      expect(bag.userId, 'user-1');
      expect(bag.quantity, 3);
      expect(bag.status, 'PENDING');
    });

    test('fromJson parses nested wasteType', () {
      final json = {
        ...baseJson,
        'wasteType': {'name': 'Botol Plastik'},
      };

      final bag = TrashBag.fromJson(json);
      expect(bag.wasteTypeName, 'Botol Plastik');
    });

    test('statusLabel returns correct labels', () {
      expect(TrashBag.fromJson({...baseJson, 'status': 'PENDING'}).statusLabel, 'Menunggu Verifikasi');
      expect(TrashBag.fromJson({...baseJson, 'status': 'APPROVED'}).statusLabel, 'Disetujui');
      expect(TrashBag.fromJson({...baseJson, 'status': 'REJECTED'}).statusLabel, 'Ditolak');
      expect(TrashBag.fromJson({...baseJson, 'status': 'COMPLETED'}).statusLabel, 'Selesai');
    });

    test('statusTone returns correct tones', () {
      expect(TrashBag.fromJson({...baseJson, 'status': 'PENDING'}).statusTone, 'warning');
      expect(TrashBag.fromJson({...baseJson, 'status': 'APPROVED'}).statusTone, 'brand');
      expect(TrashBag.fromJson({...baseJson, 'status': 'COMPLETED'}).statusTone, 'success');
      expect(TrashBag.fromJson({...baseJson, 'status': 'REJECTED'}).statusTone, 'danger');
    });

    test('fromJson handles missing fields', () {
      final bag = TrashBag.fromJson({
        'id': 'tb-1',
        'userId': 'user-1',
        'status': 'PENDING',
        'createdAt': '2024-01-01',
      });

      expect(bag.quantity, 1);
      expect(bag.photoUrl, isNull);
      expect(bag.adminNote, isNull);
    });
  });

  group('WasteType', () {
    test('fromJson parses correctly', () {
      final json = {
        'id': 'wt-1',
        'name': 'Botol Plastik',
        'unit': 'kg',
        'rewardPerKg': 5000,
      };

      final wt = WasteType.fromJson(json);
      expect(wt.id, 'wt-1');
      expect(wt.name, 'Botol Plastik');
      expect(wt.unit, 'kg');
      expect(wt.rewardPerKg, 5000);
    });

    test('fromJson handles nullable fields', () {
      final json = {'id': 'wt-1', 'name': 'Sampah'};
      final wt = WasteType.fromJson(json);
      expect(wt.unit, isNull);
      expect(wt.rewardPerKg, isNull);
    });
  });
}
