import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/core/models/redemption.dart';
import 'package:reloop_mobile/features/wallet/wallet_screen.dart';
import 'package:reloop_mobile/services/offline_service.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
  });

  Map<String, dynamic> walletData({
    bool withAccounts = true,
    bool withRedemptions = true,
    bool withHistory = true,
    bool isTravelAgent = false,
  }) =>
      {
        'balance': {
          'available': 25000,
          'pending': 3000,
          'redeemed': 10000,
          'reserved': 2000,
          'totalEarned': 40000,
        },
        'pointsToRupiah': 5,
        'isTravelAgent': isTravelAgent,
        'payoutAccounts': withAccounts
            ? [
                {
                  'id': 'acc1',
                  'provider': 'GOPAY',
                  'accountIdentifier': '08123456789',
                  'accountName': 'Farhan',
                  'status': 'ACTIVE',
                },
              ]
            : [],
        'redemptions': withRedemptions
            ? [
                {
                  'id': 'r1',
                  'amount': 10000,
                  'provider': 'GOPAY',
                  'status': 'REQUESTED',
                  'createdAt': '2026-07-10T06:00:00Z',
                },
              ]
            : [],
        'history': withHistory
            ? [
                {
                  'id': 'h1',
                  'userId': 'u1',
                  'entryType': 'EARN',
                  'amount': 5000,
                  'status': 'AVAILABLE',
                  'createdAt': '2026-07-10T08:00:00Z',
                  'depositItem': {
                    'wasteType': {'name': 'Plastik'},
                    'baseRewardAmount': 6000,
                    'complianceMultiplier': 0.8,
                  },
                },
                {
                  'id': 'h2',
                  'userId': 'u1',
                  'entryType': 'REDEEM',
                  'amount': -2000,
                  'status': 'COMPLETED',
                  'createdAt': '2026-07-09T08:00:00Z',
                  'reasonCode': 'REDEMPTION',
                },
              ]
            : [],
      };

  Widget buildApp() {
    final router = GoRouter(
      initialLocation: '/wallet',
      routes: [
        GoRoute(path: '/wallet', builder: (_, __) => const WalletScreen()),
        GoRoute(
          path: '/wallet/redemption',
          builder: (_, __) => const Scaffold(body: Text('REDEMPTION PAGE')),
        ),
        GoRoute(
          path: '/wallet/add-account',
          builder: (_, __) => const Scaffold(body: Text('ADD ACCOUNT PAGE')),
        ),
      ],
    );

    return Provider<ApiClient>.value(
      value: mockApi,
      child: MaterialApp.router(
        theme: AppTheme.light,
        routerConfig: router,
      ),
    );
  }

  group('WalletScreen widget', () {
    testWidgets('loads balance, accounts, redemptions and history', (tester) async {
      await tester.binding.setSurfaceSize(const Size(800, 2000));
      when(() => mockApi.get('/api/wallet')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/wallet'),
          data: walletData(isTravelAgent: true),
        ),
      );

      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      expect(find.text('Saldo Tersedia'), findsOneWidget);
      expect(find.textContaining('Rp 25.000'), findsWidgets);
      expect(find.textContaining('poin tersedia'), findsOneWidget);
      expect(find.text('Cairkan Saldo'), findsOneWidget);
      expect(find.text('Rekening Pencairan'), findsOneWidget);
      expect(find.text('GOPAY'), findsOneWidget);
      expect(find.text('08123456789'), findsOneWidget);
      expect(find.text('Riwayat Pencairan'), findsOneWidget);
      expect(find.text('Riwayat Transaksi'), findsOneWidget);
      expect(find.text('Plastik'), findsOneWidget);
      expect(find.textContaining('Denda Kepatuhan'), findsOneWidget);
    });

    testWidgets('shows empty states when accounts and history missing', (tester) async {
      await tester.binding.setSurfaceSize(const Size(800, 1600));
      when(() => mockApi.get('/api/wallet')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/wallet'),
          data: walletData(withAccounts: false, withRedemptions: false, withHistory: false),
        ),
      );

      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      expect(find.text('Belum ada akun pencairan'), findsOneWidget);
      expect(find.text('Belum ada transaksi'), findsOneWidget);
      expect(find.text('Riwayat Pencairan'), findsNothing);
    });

    testWidgets('navigates to redemption and add-account', (tester) async {
      await tester.binding.setSurfaceSize(const Size(800, 1600));
      when(() => mockApi.get('/api/wallet')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/wallet'),
          data: walletData(),
        ),
      );

      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Cairkan Saldo'));
      await tester.pumpAndSettle();
      expect(find.text('REDEMPTION PAGE'), findsOneWidget);

      // Go back via router by pumping wallet again
      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Tambah'));
      await tester.pumpAndSettle();
      expect(find.text('ADD ACCOUNT PAGE'), findsOneWidget);
    });

    testWidgets('disables payout account after confirm', (tester) async {
      await tester.binding.setSurfaceSize(const Size(800, 1600));
      when(() => mockApi.get('/api/wallet')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/wallet'),
          data: walletData(),
        ),
      );
      when(() => mockApi.delete('/api/payout-accounts/acc1')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/payout-accounts/acc1'),
          data: {'ok': true},
        ),
      );

      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Nonaktifkan Akun'));
      await tester.pumpAndSettle();
      expect(find.text('Nonaktifkan Akun?'), findsOneWidget);

      await tester.tap(find.text('Nonaktifkan'));
      await tester.pumpAndSettle();

      expect(find.text('Akun dinonaktifkan'), findsOneWidget);
      verify(() => mockApi.delete('/api/payout-accounts/acc1')).called(1);
    });

    testWidgets('cancels redemption after confirm', (tester) async {
      await tester.binding.setSurfaceSize(const Size(800, 1600));
      when(() => mockApi.get('/api/wallet')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/wallet'),
          data: walletData(),
        ),
      );
      when(() => mockApi.patch('/api/redemptions/r1', data: any(named: 'data'))).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/redemptions/r1'),
          data: {'ok': true},
        ),
      );

      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Batalkan'));
      await tester.pumpAndSettle();
      expect(find.text('Batalkan Pencairan?'), findsOneWidget);

      await tester.tap(find.text('Ya, Batalkan'));
      await tester.pumpAndSettle();

      expect(find.text('Pencairan dibatalkan'), findsOneWidget);
    });

    testWidgets('shows error state with retry', (tester) async {
      await tester.binding.setSurfaceSize(const Size(800, 1200));
      when(() => mockApi.get('/api/wallet')).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/wallet'),
          type: DioExceptionType.connectionError,
        ),
      );

      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      expect(
        find.textContaining('Tidak dapat terhubung ke server'),
        findsOneWidget,
      );
      expect(find.text('Coba lagi'), findsOneWidget);
    });

    testWidgets('offline banner when cache available', (tester) async {
      OfflineService.debugGetOverride = (key) {
        if (key == 'wallet') return walletData();
        return null;
      };
      when(() => mockApi.get('/api/wallet')).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/wallet'),
          type: DioExceptionType.connectionError,
        ),
      );

      await tester.binding.setSurfaceSize(const Size(800, 1600));
      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      expect(
        find.textContaining('Menampilkan data tersimpan (offline)'),
        findsOneWidget,
      );
      OfflineService.debugGetOverride = null;
    });

    testWidgets('disable account API error shows snackbar', (tester) async {
      await tester.binding.setSurfaceSize(const Size(800, 1600));
      when(() => mockApi.get('/api/wallet')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/wallet'),
          data: walletData(),
        ),
      );
      when(() => mockApi.delete('/api/payout-accounts/acc1')).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/payout-accounts/acc1'),
          response: Response(
            requestOptions: RequestOptions(path: '/api/payout-accounts/acc1'),
            statusCode: 500,
            data: {'error': 'Terjadi kesalahan pada server.'},
          ),
          type: DioExceptionType.badResponse,
        ),
      );

      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Nonaktifkan Akun'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Nonaktifkan'));
      await tester.pumpAndSettle();
      expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    });

    testWidgets('cancel redemption API error shows snackbar', (tester) async {
      await tester.binding.setSurfaceSize(const Size(800, 1600));
      when(() => mockApi.get('/api/wallet')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/api/wallet'),
          data: walletData(),
        ),
      );
      when(() => mockApi.patch('/api/redemptions/r1', data: any(named: 'data')))
          .thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/redemptions/r1'),
          response: Response(
            requestOptions: RequestOptions(path: '/api/redemptions/r1'),
            statusCode: 500,
            data: {'error': 'Terjadi kesalahan pada server.'},
          ),
          type: DioExceptionType.badResponse,
        ),
      );

      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Batalkan'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ya, Batalkan'));
      await tester.pumpAndSettle();
      expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    });
  });

  group('Wallet models', () {
    test('WalletBalance formats values', () {
      final balance = WalletBalance.fromJson({
        'available': 15000,
        'pending': 2000,
        'redeemed': 5000,
        'reserved': 1000,
        'totalEarned': 23000,
      });

      expect(balance.availableFormatted, 'Rp 15.000');
      expect(balance.pendingFormatted, 'Rp 2.000');
      expect(balance.totalEarnedFormatted, 'Rp 23.000');
    });

    test('RewardLedgerEntry reads nested fields and formats amounts', () {
      final entry = RewardLedgerEntry.fromJson({
        'id': 'h1',
        'userId': 'u1',
        'entryType': 'EARN',
        'amount': 5000,
        'status': 'AVAILABLE',
        'createdAt': '2026-07-10T08:00:00Z',
        'depositItem': {
          'wasteType': {'name': 'Plastik'},
          'baseRewardAmount': 6000,
          'complianceMultiplier': 0.8,
        },
        'session': {
          'machine': {'name': 'Mesin A'},
        },
      });

      expect(entry.wasteTypeName, 'Plastik');
      expect(entry.machineName, 'Mesin A');
      expect(entry.baseRewardAmount, 6000);
      expect(entry.complianceMultiplier, 0.8);
      expect(entry.amount, 5000);
    });

    test('PayoutAccount and Redemption parse status fields', () {
      final account = PayoutAccount.fromJson({
        'id': 'a1',
        'provider': 'BCA',
        'accountIdentifier': '1234567890',
        'accountName': 'Farhan',
        'status': 'ACTIVE',
      });
      final redemption = Redemption.fromJson({
        'id': 'r1',
        'amount': 10000,
        'provider': 'BCA',
        'status': 'REQUESTED',
        'createdAt': '2026-07-10T06:00:00Z',
      });

      expect(account.provider, 'BCA');
      expect(account.status, 'ACTIVE');
      expect(redemption.amountFormatted, 'Rp 10.000');
      expect(redemption.statusLabel, 'Menunggu');
    });
  });
}
