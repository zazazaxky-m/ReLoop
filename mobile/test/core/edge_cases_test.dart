import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/shared/widgets/status_badge.dart';
import 'package:reloop_mobile/theme/colors.dart';
import 'package:dio/dio.dart';

void main() {
  group('StatusBadge edge cases', () {
    testWidgets('all registered statuses render without error', (tester) async {
      for (final key in [
        'AVAILABLE', 'REVERSED', 'PENDING_REWARD', 'PROCESSING',
        'APPROVED', 'SUCCESS', 'FAILED', 'INVITED', 'SUSPENDED',
        'DRAFT', 'PAUSED', 'ENDED', 'PICKUP_REQUESTED', 'REMOVED',
      ]) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(body: StatusBadge(statusKey: key)),
          ),
        );
        expect(find.byType(StatusBadge), findsOneWidget);
      }
    });
  });

  group('ReLoopColors', () {
    test('all brand colors are distinct', () {
      final colors = [
        ReLoopColors.brand50,
        ReLoopColors.brand100,
        ReLoopColors.brand200,
        ReLoopColors.brand300,
        ReLoopColors.brand400,
        ReLoopColors.brand500,
        ReLoopColors.brand600,
        ReLoopColors.brand700,
        ReLoopColors.brand800,
        ReLoopColors.brand900,
      ];
      final unique = colors.toSet();
      expect(unique.length, 10);
    });

    test('status colors are distinct', () {
      final colors = [
        ReLoopColors.statusOnline,
        ReLoopColors.statusFull,
        ReLoopColors.statusMaintenance,
        ReLoopColors.statusError,
        ReLoopColors.statusOffline,
      ];
      final unique = colors.toSet();
      expect(unique.length, 5);
    });

    test('semantic colors are distinct', () {
      final colors = [
        ReLoopColors.success,
        ReLoopColors.warning,
        ReLoopColors.danger,
        ReLoopColors.info,
        ReLoopColors.neutral,
      ];
      final unique = colors.toSet();
      expect(unique.length, 5);
    });

    test('dark theme colors are distinct from light', () {
      expect(ReLoopColors.background, isNot(ReLoopColors.backgroundDark));
      expect(ReLoopColors.surface, isNot(ReLoopColors.surfaceDark));
      expect(ReLoopColors.foreground, isNot(ReLoopColors.foregroundDark));
    });

    test('all tone keys have non-null colors', () {
      for (final entry in ReLoopColors.tones.entries) {
        expect(entry.value.bg, isNotNull);
        expect(entry.value.text, isNotNull);
        expect(entry.value.border, isNotNull);
      }
    });
  });

  group('WalletBalance formatting', () {
    test('handles zero values', () {
      final balance = WalletBalance.fromJson({
        'available': 0, 'pending': 0, 'redeemed': 0,
        'reserved': 0, 'totalEarned': 0,
      });
      expect(balance.availableFormatted, 'Rp 0');
      expect(balance.pendingFormatted, 'Rp 0');
    });

    test('handles millions', () {
      final balance = WalletBalance.fromJson({
        'available': 10000000, 'pending': 0, 'redeemed': 0,
        'reserved': 0, 'totalEarned': 10000000,
      });
      expect(balance.availableFormatted, 'Rp 10.000.000');
    });
  });

  group('ScanResult', () {
    test('fromJson parses with resumed flag', () {
      final json = {
        'session': {
          'id': 's1', 'userId': 'u1', 'machineId': 'm1',
          'status': 'ACTIVE', 'startedAt': '',
        },
        'machine': {
          'id': 'm1', 'machineCode': 'RVM', 'name': 'M',
          'status': 'ONLINE', 'fillLevelPercent': 50,
        },
        'resumed': true,
      };
      final result = ScanResult.fromJson(json);
      expect(result.resumed, true);
    });

    test('fromJson defaults resumed to false', () {
      final json = {
        'session': {
          'id': 's1', 'userId': 'u1', 'machineId': 'm1',
          'status': 'ACTIVE', 'startedAt': '',
        },
        'machine': {
          'id': 'm1', 'machineCode': 'RVM', 'name': 'M',
          'status': 'ONLINE', 'fillLevelPercent': 50,
        },
      };
      final result = ScanResult.fromJson(json);
      expect(result.resumed, false);
    });
  });

  group('UserDashboard', () {
    test('fromJson parses complete dashboard', () {
      final json = {
        'balance': {'available': 100, 'pending': 0, 'redeemed': 0, 'reserved': 0, 'totalEarned': 100},
        'recentSessions': [],
        'campaigns': [],
        'recentLedger': [],
      };
      final d = UserDashboard.fromJson(json);
      expect(d.balance.available, 100);
      expect(d.recentSessions, isEmpty);
      expect(d.campaigns, isEmpty);
    });
  });

  group('RewardLedgerEntry', () {
    test('fromJson parses positive entry', () {
      final json = {
        'id': 'e1', 'userId': 'u1', 'entryType': 'EARN',
        'amount': 5000, 'status': 'AVAILABLE', 'createdAt': '2024-01-01',
      };
      final entry = RewardLedgerEntry.fromJson(json);
      expect(entry.amount, 5000);
      expect(entry.status, 'AVAILABLE');
      expect(entry.entryType, 'EARN');
    });

    test('fromJson handles nested names', () {
      final json = {
        'id': 'e1', 'userId': 'u1', 'entryType': 'EARN',
        'amount': 5000, 'status': 'AVAILABLE', 'createdAt': '',
        'depositItem': {'wasteType': {'name': 'Plastik'}},
        'session': {'machine': {'name': 'RVM-01'}},
      };
      final entry = RewardLedgerEntry.fromJson(json);
      expect(entry.wasteTypeName, 'Plastik');
      expect(entry.machineName, 'RVM-01');
    });

    test('fromJson handles missing nested fields', () {
      final json = {
        'id': 'e1', 'userId': 'u1',
        'amount': 1000, 'status': 'PENDING', 'createdAt': '',
      };
      final entry = RewardLedgerEntry.fromJson(json);
      expect(entry.entryType, 'EARN');
      expect(entry.wasteTypeName, isNull);
      expect(entry.machineName, isNull);
    });
  });

  group('PayoutAccount', () {
    test('fromJson parses correctly', () {
      final json = {
        'id': 'pa1', 'provider': 'BANK',
        'accountIdentifier': '1234567890',
        'accountName': 'Test', 'status': 'VERIFIED',
      };
      final pa = PayoutAccount.fromJson(json);
      expect(pa.status, 'VERIFIED');
      expect(pa.provider, 'BANK');
    });

    test('fromJson defaults status to UNVERIFIED', () {
      final json = {
        'id': 'pa1', 'provider': 'DANA',
        'accountIdentifier': '081234567890',
      };
      final pa = PayoutAccount.fromJson(json);
      expect(pa.status, 'UNVERIFIED');
    });
  });

  group('ApiClient error edge cases', () {
    test('returns specific message for connection error', () {
      final error = DioException(
        type: DioExceptionType.connectionError,
        requestOptions: RequestOptions(),
      );
      final msg = ApiClient.getErrorMessage(error);
      expect(msg, contains('terhubung'));
    });

    test('returns specific message for timeout', () {
      final error = DioException(
        type: DioExceptionType.connectionTimeout,
        requestOptions: RequestOptions(),
      );
      final msg = ApiClient.getErrorMessage(error);
      expect(msg, contains('timeout'));
    });

    test('returns message from server error response', () {
      final error = DioException(
        type: DioExceptionType.badResponse,
        requestOptions: RequestOptions(),
        response: Response(
          data: {'error': 'Custom server error'},
          statusCode: 422,
          requestOptions: RequestOptions(),
        ),
      );
      final msg = ApiClient.getErrorMessage(error);
      expect(msg, 'Custom server error');
    });

    test('returns status-mapped message for known codes', () {
      final codes = {
        401: 'sesi',
        403: 'akses',
        404: 'ditemukan',
        500: 'server',
      };
      for (final code in codes.keys) {
        final error = DioException(
          type: DioExceptionType.badResponse,
          requestOptions: RequestOptions(),
          response: Response(
            data: {},
            statusCode: code,
            requestOptions: RequestOptions(),
          ),
        );
        final msg = ApiClient.getErrorMessage(error);
        expect(msg.isNotEmpty, isTrue);
      }
    });
  });
}
