import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/models.dart';

void main() {
  group('Models - AppRole', () {
    test('AppRole enum maps to string correctly', () {
      expect(AppRole.USER.apiValue, 'USER');
      expect(AppRole.SUPERADMIN.apiValue, 'SUPERADMIN');
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
}
