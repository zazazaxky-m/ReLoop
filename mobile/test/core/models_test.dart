import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/models.dart';

void main() {
  group('Models - AppRole', () {
    test('AppRole enum maps to string correctly', () {
      expect(AppRole.USER.apiValue, 'USER');
      expect(AppRole.SUPERADMIN.apiValue, 'SUPERADMIN');
      expect(AppRole.USER.label, 'User');
      expect(AppRole.PENGEPUL.label, 'Pengepul');
      expect(AppRole.ADMIN.label, 'Admin');
      expect(AppRole.SUPERADMIN.label, 'Superadmin');
    });

    test('String maps to AppRole enum correctly', () {
      expect(AppRoleX.fromString('PENGEPUL'), AppRole.PENGEPUL);
      expect(AppRoleX.fromString('ADMIN'), AppRole.ADMIN);
      expect(AppRoleX.fromString('INVALID_ROLE'), AppRole.USER); // Default fallback
    });
  });

  group('Models - CurrentUser', () {
    test('fromJson parses full data correctly', () {
      final json = {
        'id': 'u123',
        'name': 'Farhan',
        'email': 'farhan@reloop.id',
        'phone': '0812345678',
        'role': 'SUPERADMIN',
        'organizationId': 'org1',
        'organizationName': 'ReLoop HQ',
        'payoutEligible': true,
        'status': 'ACTIVE',
      };

      final user = CurrentUser.fromJson(json);

      expect(user.id, 'u123');
      expect(user.name, 'Farhan');
      expect(user.role, AppRole.SUPERADMIN);
      expect(user.phone, '0812345678');
      expect(user.organizationName, 'ReLoop HQ');
      expect(user.payoutEligible, isTrue);
    });

    test('fromJson handles missing/null values safely', () {
      final json = {
        // missing id, name, email
        'role': 'USER',
      };

      final user = CurrentUser.fromJson(json);

      expect(user.id, '');
      expect(user.name, '');
      expect(user.phone, isNull);
      expect(user.role, AppRole.USER);
      expect(user.payoutEligible, isFalse); // default
      expect(user.status, 'ACTIVE'); // default
    });
  });

  group('Models - WalletBalance', () {
    test('fromJson parses numeric data safely', () {
      final json = {
        'available': 50000,
        'pending': 10000.5, // Should truncate/toInt
        'redeemed': 5000.9, // Should truncate/toInt
      };

      final balance = WalletBalance.fromJson(json);

      expect(balance.available, 50000);
      expect(balance.pending, 10000); // 10000.5 -> 10000
      expect(balance.redeemed, 5000); // 5000.9 -> 5000
      expect(balance.totalEarned, 0);
    });

    test('availableFormatted formats correctly to Rupiah', () {
      final balance = WalletBalance(
        available: 1500000,
        pending: 0,
        redeemed: 0,
        reserved: 0,
        totalEarned: 0,
      );

      expect(balance.availableFormatted, 'Rp 1.500.000');
    });

    test('pending and totalEarned formatters', () {
      final balance = WalletBalance(
        available: 0,
        pending: 2500,
        redeemed: 0,
        reserved: 0,
        totalEarned: 99000,
      );
      expect(balance.pendingFormatted, 'Rp 2.500');
      expect(balance.totalEarnedFormatted, 'Rp 99.000');
    });
  });

  group('Models - UserDashboard', () {
    test('fromJson throws exception if balance is missing', () {
      final json = {
        'recentSessions': [],
      };

      expect(() => UserDashboard.fromJson(json), throwsException);
    });

    test('fromJson parses dashboard completely', () {
      final json = {
        'balance': {
          'available': 1000,
        },
        'recentSessions': [],
        'campaigns': [],
        'recentLedger': [],
        'isTravelAgent': true,
        'pointsToRupiah': 100,
      };

      final dashboard = UserDashboard.fromJson(json);
      expect(dashboard.balance.available, 1000);
      expect(dashboard.isTravelAgent, isTrue);
      expect(dashboard.pointsToRupiah, 100);
    });
  });

  group('Models - DepositSession campaign branch', () {
    test('fromJson parses nested campaign', () {
      final session = DepositSession.fromJson({
        'id': 's1',
        'userId': 'u1',
        'machineId': 'm1',
        'status': 'ACTIVE',
        'startedAt': '2024-01-01',
        'machine': {
          'id': 'm1',
          'machineCode': 'RVM-1',
          'name': 'Mesin A',
          'status': 'ONLINE',
          'fillLevelPercent': 5,
        },
        'campaign': {
          'id': 'c1',
          'name': 'Kampanye',
          'campaignType': 'EVENT',
          'visibility': 'PUBLIC',
          'status': 'ACTIVE',
          'startDate': '2024-01-01',
        },
        'items': [
          {
            'id': 'i1',
            'sessionId': 's1',
            'quantity': 2,
            'status': 'ACCEPTED',
            'source': 'MACHINE',
            'wasteType': {'id': 'w1', 'name': 'PET'},
          },
        ],
      });
      expect(session.machine?.name, 'Mesin A');
      expect(session.campaign?.id, 'c1');
      expect(session.campaign?.name, 'Kampanye');
      expect(session.items?.length, 1);
      expect(session.items!.first.wasteType?.name, 'PET');
    });
  });

  group('Models - MachineInfo and WasteTypeRef', () {
    test('parses supportedWasteTypes', () {
      final machine = MachineInfo.fromJson({
        'id': 'm1',
        'machineCode': 'RVM-1',
        'name': 'Mesin',
        'status': 'ONLINE',
        'fillLevelPercent': 10,
        'supportedWasteTypes': [
          {'id': 'w1', 'name': 'Plastik'},
        ],
      });
      expect(machine.supportedWasteTypes!.first.name, 'Plastik');
      expect(WasteTypeRef.fromJson({'id': 'x', 'name': 'Y'}).id, 'x');
    });
  });

  group('Models - DepositItem', () {
    test('fromJson parses fields', () {
      final item = DepositItem.fromJson({
        'id': 'di1',
        'sessionId': 's1',
        'quantity': 1,
        'measuredWeightGrams': 100,
        'aiDetectedType': 'PET',
        'aiConfidence': 0.9,
        'baseRewardAmount': 500,
        'complianceMultiplier': 1.5,
        'rewardAmount': 750,
        'status': 'ACCEPTED',
        'source': 'MACHINE',
      });
      expect(item.rewardAmount, 750);
      expect(item.aiConfidence, 0.9);
    });
  });

  group('Models - RewardLedgerEntry.displayLabel', () {
    test('prefers wasteTypeName when present', () {
      final entry = RewardLedgerEntry.fromJson({
        'id': 'e1',
        'userId': 'u1',
        'entryType': 'EARN',
        'amount': 100,
        'status': 'AVAILABLE',
        'createdAt': '',
        'reasonCode': 'DEPOSIT_ACCEPTED',
        'depositItem': {
          'wasteType': {'name': 'Plastik PET'},
        },
      });
      expect(entry.displayLabel, 'Plastik PET');
    });

    test('falls back to entryType when reasonCode empty', () {
      final entry = RewardLedgerEntry.fromJson({
        'id': 'e2',
        'userId': 'u1',
        'entryType': 'ADJUSTMENT',
        'amount': 50,
        'status': 'AVAILABLE',
        'createdAt': '',
        'reasonCode': '',
      });
      expect(entry.displayLabel, 'ADJUSTMENT');
    });

    test('formats unknown reasonCode', () {
      final entry = RewardLedgerEntry.fromJson({
        'id': 'e3',
        'userId': 'u1',
        'entryType': 'EARN',
        'amount': 10,
        'status': 'AVAILABLE',
        'createdAt': '',
        'reasonCode': 'CUSTOM_BONUS_X',
      });
      expect(entry.displayLabel, 'CUSTOM BONUS X');
    });
  });

  group('Models - ScanResult and PayoutAccount', () {
    test('ScanResult.fromJson', () {
      final result = ScanResult.fromJson({
        'resumed': true,
        'session': {
          'id': 's1',
          'userId': 'u1',
          'machineId': 'm1',
          'status': 'ACTIVE',
          'startedAt': '',
        },
        'machine': {
          'id': 'm1',
          'machineCode': 'RVM',
          'name': 'Mesin',
          'status': 'ONLINE',
          'fillLevelPercent': 0,
        },
      });
      expect(result.resumed, isTrue);
      expect(result.machine.machineCode, 'RVM');
    });

    test('PayoutAccount.fromJson', () {
      final pa = PayoutAccount.fromJson({
        'id': 'pa1',
        'provider': 'BANK',
        'accountIdentifier': '123',
        'accountName': 'Nama',
        'status': 'VERIFIED',
      });
      expect(pa.provider, 'BANK');
      expect(pa.accountName, 'Nama');
    });

    test('PayoutAccount defaults status to UNVERIFIED', () {
      final pa = PayoutAccount.fromJson({
        'id': 'pa2',
        'provider': 'EWALLET',
        'accountIdentifier': '0812',
      });
      expect(pa.status, 'UNVERIFIED');
      expect(pa.accountName, isNull);
    });

    test('ScanResult resumed defaults false', () {
      final result = ScanResult.fromJson({
        'session': {
          'id': 's1',
          'userId': 'u1',
          'machineId': 'm1',
          'status': 'ACTIVE',
          'startedAt': '',
        },
        'machine': {
          'id': 'm1',
          'machineCode': 'RVM',
          'name': 'Mesin',
          'status': 'ONLINE',
          'fillLevelPercent': 0,
        },
      });
      expect(result.resumed, isFalse);
    });
  });

  group('Models - CampaignInfo extras', () {
    test('parses dates domains and nested org', () {
      final c = CampaignInfo.fromJson({
        'id': 'c1',
        'name': 'Kampanye',
        'startAt': '2024-06-01T00:00:00Z',
        'endAt': '2024-06-30T00:00:00Z',
        'allowedEmailDomains': ['corp.com', 'reloop.id'],
        'organization': {'name': 'Org Nested'},
        'rewardMultiplier': 2.5,
      });
      expect(c.startAt, isNotNull);
      expect(c.endAt, isNotNull);
      expect(c.allowedEmailDomains, ['corp.com', 'reloop.id']);
      expect(c.organizationName, 'Org Nested');
      expect(c.rewardMultiplier, 2.5);
      expect(c.campaignType, 'MACHINE_DEPOSIT');
      expect(c.status, 'DRAFT');
    });

    test('defaults for minimal json', () {
      final c = CampaignInfo.fromJson({'id': 'x', 'name': 'Y'});
      expect(c.visibility, 'PUBLIC');
      expect(c.startAt, isNull);
      expect(c.allowedEmailDomains, isNull);
    });
  });

  group('Models - MachineInfo extras', () {
    test('parses nested org and coordinates', () {
      final m = MachineInfo.fromJson({
        'id': 'm1',
        'machineCode': 'RVM-1',
        'name': 'Mesin',
        'status': 'ONLINE',
        'fillLevelPercent': 10,
        'organization': {'name': 'Org M'},
        'latitude': -6.2,
        'longitude': 106.8,
      });
      expect(m.organizationName, 'Org M');
      expect(m.latitude, -6.2);
      expect(m.longitude, 106.8);
    });
  });

  group('Models - DepositSession without nested', () {
    test('null machine campaign items', () {
      final s = DepositSession.fromJson({
        'id': 's1',
        'userId': 'u1',
        'machineId': 'm1',
        'status': 'ACTIVE',
        'startedAt': '2024-01-01',
      });
      expect(s.machine, isNull);
      expect(s.campaign, isNull);
      expect(s.items, isNull);
    });
  });

  group('Models - RewardLedgerEntry reason codes', () {
    RewardLedgerEntry entry(String? reason) => RewardLedgerEntry.fromJson({
          'id': '1',
          'userId': 'u',
          'entryType': 'EARN',
          'amount': 1,
          'status': 'AVAILABLE',
          'createdAt': '',
          'reasonCode': reason,
        });

    test('maps known reason codes', () {
      expect(entry('TRASH_BAG_RETURN').displayLabel, 'Reward trash bag');
      expect(entry('DEPOSIT_ACCEPTED').displayLabel, 'Setoran mesin');
      expect(entry('ITEM_ACCEPTED').displayLabel, 'Setoran mesin');
      expect(entry('ANOMALY_REVIEW').displayLabel, 'Setoran ditinjau');
      expect(
        entry('TOURISM_COMPLIANCE_BONUS').displayLabel,
        'Bonus kepatuhan wisata',
      );
      expect(entry('REDEMPTION_SUCCESS').displayLabel, 'Pencairan');
      expect(entry('REDEMPTION_PROCESSING').displayLabel, 'Pencairan');
      expect(entry('REDEMPTION_RESERVE').displayLabel, 'Pencairan');
      expect(entry('REDEMPTION_REVERSED').displayLabel, 'Pencairan dibatalkan');
    });

    test('parses nested machineName', () {
      final e = RewardLedgerEntry.fromJson({
        'id': '1',
        'userId': 'u',
        'entryType': 'EARN',
        'amount': 1,
        'status': 'AVAILABLE',
        'createdAt': '',
        'session': {
          'machine': {'name': 'Mesin Nested'},
        },
        'depositItem': {
          'baseRewardAmount': 100,
          'complianceMultiplier': 1.2,
        },
      });
      expect(e.machineName, 'Mesin Nested');
      expect(e.baseRewardAmount, 100);
      expect(e.complianceMultiplier, 1.2);
    });
  });

  group('Models - WalletBalance reserved', () {
    test('parses reserved field', () {
      final b = WalletBalance.fromJson({
        'available': 1,
        'pending': 2,
        'redeemed': 3,
        'reserved': 100,
        'totalEarned': 4,
      });
      expect(b.reserved, 100);
      expect(b.totalEarned, 4);
    });
  });

  group('Models - CurrentUser organizationId', () {
    test('parses organizationId', () {
      final u = CurrentUser.fromJson({
        'id': 'u1',
        'name': 'N',
        'email': 'e@e.com',
        'role': 'USER',
        'organizationId': 'org-99',
        'status': 'ACTIVE',
      });
      expect(u.organizationId, 'org-99');
    });
  });
}
