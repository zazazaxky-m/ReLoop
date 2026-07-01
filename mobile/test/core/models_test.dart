import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/models.dart';

void main() {
  group('AppRole enum', () {
    test('apiValue returns correct values', () {
      expect(AppRole.USER.apiValue, 'USER');
      expect(AppRole.PENGEPUL.apiValue, 'PENGEPUL');
      expect(AppRole.ADMIN.apiValue, 'ADMIN');
      expect(AppRole.SUPERADMIN.apiValue, 'SUPERADMIN');
    });

    test('label returns correct labels', () {
      expect(AppRole.USER.label, 'User');
      expect(AppRole.PENGEPUL.label, 'Pengepul');
      expect(AppRole.ADMIN.label, 'Admin');
      expect(AppRole.SUPERADMIN.label, 'Superadmin');
    });

    test('fromString parses correctly', () {
      expect(AppRoleX.fromString('USER'), AppRole.USER);
      expect(AppRoleX.fromString('PENGEPUL'), AppRole.PENGEPUL);
      expect(AppRoleX.fromString('ADMIN'), AppRole.ADMIN);
      expect(AppRoleX.fromString('SUPERADMIN'), AppRole.SUPERADMIN);
    });

    test('fromString returns USER for unknown', () {
      expect(AppRoleX.fromString('UNKNOWN'), AppRole.USER);
      expect(AppRoleX.fromString(''), AppRole.USER);
    });
  });

  group('CurrentUser', () {
    test('fromJson parses all fields', () {
      final json = {
        'id': 'user-1',
        'name': 'Test User',
        'email': 'test@reloop.id',
        'phone': '08123456789',
        'role': 'USER',
        'organizationId': 'org-1',
        'organizationName': 'Test Org',
        'payoutEligible': true,
        'status': 'ACTIVE',
      };

      final user = CurrentUser.fromJson(json);

      expect(user.id, 'user-1');
      expect(user.name, 'Test User');
      expect(user.email, 'test@reloop.id');
      expect(user.phone, '08123456789');
      expect(user.role, AppRole.USER);
      expect(user.organizationId, 'org-1');
      expect(user.organizationName, 'Test Org');
      expect(user.payoutEligible, true);
      expect(user.status, 'ACTIVE');
    });

    test('fromJson handles missing optional fields', () {
      final json = {
        'id': 'user-1',
        'name': 'Test User',
        'email': 'test@reloop.id',
        'role': 'USER',
      };

      final user = CurrentUser.fromJson(json);

      expect(user.phone, isNull);
      expect(user.organizationId, isNull);
      expect(user.organizationName, isNull);
      expect(user.payoutEligible, false);
      expect(user.status, 'ACTIVE');
    });
  });

  group('WalletBalance', () {
    final json = {
      'available': 50000,
      'pending': 10000,
      'redeemed': 25000,
      'reserved': 0,
      'totalEarned': 85000,
    };

    test('fromJson parses correctly', () {
      final balance = WalletBalance.fromJson(json);
      expect(balance.available, 50000);
      expect(balance.pending, 10000);
      expect(balance.redeemed, 25000);
      expect(balance.reserved, 0);
      expect(balance.totalEarned, 85000);
    });

    test('availableFormatted formats correctly', () {
      final balance = WalletBalance.fromJson(json);
      expect(balance.availableFormatted, 'Rp 50.000');
    });

    test('pendingFormatted formats correctly', () {
      final balance = WalletBalance.fromJson(json);
      expect(balance.pendingFormatted, 'Rp 10.000');
    });

    test('totalEarnedFormatted formats correctly', () {
      final balance = WalletBalance.fromJson(json);
      expect(balance.totalEarnedFormatted, 'Rp 85.000');
    });

    test('formats large amounts correctly', () {
      final balance = WalletBalance.fromJson({
        'available': 1500000,
        'pending': 0,
        'redeemed': 0,
        'reserved': 0,
        'totalEarned': 1500000,
      });
      expect(balance.availableFormatted, 'Rp 1.500.000');
    });
  });

  group('MachineInfo', () {
    test('fromJson parses full machine', () {
      final json = {
        'id': 'machine-1',
        'machineCode': 'RVM-001',
        'name': 'Mesin Test',
        'organizationName': 'Org Test',
        'status': 'ONLINE',
        'fillLevelPercent': 45,
        'latitude': -6.2088,
        'longitude': 106.8456,
        'supportedWasteTypes': [
          {'id': 'wt-1', 'name': 'Organik'},
          {'id': 'wt-2', 'name': 'Anorganik'},
        ],
      };

      final machine = MachineInfo.fromJson(json);

      expect(machine.id, 'machine-1');
      expect(machine.machineCode, 'RVM-001');
      expect(machine.name, 'Mesin Test');
      expect(machine.status, 'ONLINE');
      expect(machine.fillLevelPercent, 45);
      expect(machine.latitude, -6.2088);
      expect(machine.longitude, 106.8456);
      expect(machine.supportedWasteTypes?.length, 2);
      expect(machine.supportedWasteTypes?[0].name, 'Organik');
    });

    test('fromJson handles nested organization', () {
      final json = {
        'id': 'machine-1',
        'machineCode': 'RVM-001',
        'name': 'Mesin Test',
        'status': 'OFFLINE',
        'fillLevelPercent': 0,
        'organization': {'name': 'Org Nested'},
      };

      final machine = MachineInfo.fromJson(json);
      expect(machine.organizationName, 'Org Nested');
    });

    test('fromJson handles missing fields with defaults', () {
      final json = {
        'id': 'machine-1',
        'machineCode': 'RVM-001',
        'name': 'Mesin Test',
      };

      final machine = MachineInfo.fromJson(json);
      expect(machine.status, 'OFFLINE');
      expect(machine.fillLevelPercent, 0);
      expect(machine.latitude, isNull);
      expect(machine.longitude, isNull);
      expect(machine.supportedWasteTypes, isNull);
    });
  });
}
