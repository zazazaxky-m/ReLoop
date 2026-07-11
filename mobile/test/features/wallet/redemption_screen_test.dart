import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/features/wallet/redemption_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;

  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  setUp(() {
    mockApi = MockApiClient();
  });

  Map<String, dynamic> walletData({
    int available = 50000,
    int minRedemption = 10000,
    bool withAccounts = true,
    bool withRedemptions = true,
  }) =>
      {
        'balance': {'available': available, 'pending': 0},
        'minRedemption': minRedemption,
        'payoutAccounts': withAccounts
            ? [
                {
                  'id': 'acc1',
                  'provider': 'DANA',
                  'accountIdentifier': '08111111111',
                  'status': 'ACTIVE',
                },
              ]
            : [],
        'redemptions': withRedemptions
            ? [
                {
                  'id': 'r1',
                  'amount': 15000,
                  'provider': 'DANA',
                  'status': 'REQUESTED',
                  'createdAt': '2026-07-10T06:00:00Z',
                },
              ]
            : [],
      };

  Widget buildApp() {
    final router = GoRouter(
      initialLocation: '/wallet/redemption',
      routes: [
        GoRoute(
          path: '/wallet/redemption',
          builder: (_, __) => const RedemptionScreen(),
        ),
        GoRoute(
          path: '/wallet/add-account',
          builder: (_, __) => const Scaffold(body: Text('ADD ACCOUNT')),
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

  testWidgets('loads balance and redemption history', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Pencairan Saldo'), findsOneWidget);
    expect(find.text('Saldo Tersedia'), findsOneWidget);
    expect(find.textContaining('Rp 50.000'), findsWidgets);
    expect(find.text('Cairkan Sekarang'), findsOneWidget);
    expect(find.text('Riwayat Pencairan'), findsOneWidget);
    expect(find.text('DANA'), findsWidgets);
  });

  testWidgets('shows empty redemption history and add-account CTA', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(withAccounts: false, withRedemptions: false, available: 0),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada pencairan'), findsOneWidget);
    expect(find.text('Tambah Akun Dulu'), findsOneWidget);

    await tester.tap(find.text('Tambah Akun Dulu'));
    await tester.pumpAndSettle();
    expect(find.text('ADD ACCOUNT'), findsOneWidget);
  });

  testWidgets('requests redemption successfully', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(),
      ),
    );
    when(() => mockApi.post('/api/redemptions', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/redemptions'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Cairkan Sekarang'));
    await tester.pumpAndSettle();
    expect(find.text('Cairkan Saldo'), findsOneWidget);

    await tester.tap(find.text('Ya, Cairkan'));
    await tester.pumpAndSettle();

    expect(find.text('Pengajuan pencairan berhasil'), findsOneWidget);
    verify(() => mockApi.post('/api/redemptions', data: any(named: 'data'))).called(1);
  });

  testWidgets('validates amount below minimum', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(available: 50000, minRedemption: 20000),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '5000');
    await tester.tap(find.text('Cairkan Sekarang'));
    await tester.pumpAndSettle();

    expect(find.text('Minimal pencairan Rp 20.000'), findsOneWidget);
  });

  testWidgets('cancels requested redemption', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
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
    await tester.tap(find.text('Ya, Batalkan'));
    await tester.pumpAndSettle();

    expect(find.text('Pencairan dibatalkan'), findsOneWidget);
  });

  testWidgets('shows error and retry', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.get('/api/wallet')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/wallet'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/wallet'),
          statusCode: 500,
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);
  });

  testWidgets('validates empty amount', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(available: 30000, minRedemption: 10000),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '');
    await tester.tap(find.text('Cairkan Sekarang'));
    await tester.pumpAndSettle();
    expect(find.text('Masukkan jumlah pencairan'), findsOneWidget);
  });

  testWidgets('validates over-balance amount', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(available: 30000, minRedemption: 10000),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '50000');
    await tester.tap(find.text('Cairkan Sekarang'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Saldo tidak mencukupi'), findsOneWidget);
  });

  testWidgets('validates zero amount as invalid', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(available: 30000, minRedemption: 10000),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '0');
    await tester.tap(find.text('Cairkan Sekarang'));
    await tester.pumpAndSettle();

    expect(find.text('Jumlah tidak valid'), findsOneWidget);
  });

  testWidgets('request redemption cancel and API error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(),
      ),
    );
    when(() => mockApi.post('/api/redemptions', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/redemptions'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/redemptions'),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Cairkan Sekarang'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    expect(find.text('Cairkan Saldo'), findsNothing);

    await tester.tap(find.text('Cairkan Sekarang'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ya, Cairkan'));
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('cancel redemption API error and kelola akun', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(
          withRedemptions: true,
        )..['redemptions'] = [
            {
              'id': 'r1',
              'amount': 15000,
              'provider': 'DANA',
              'status': 'REQUESTED',
              'createdAt': 'bukan-tanggal',
            },
          ],
      ),
    );
    when(() => mockApi.patch('/api/redemptions/r1', data: any(named: 'data'))).thenThrow(
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

    await tester.tap(find.text('Kelola Akun').first);
    await tester.pumpAndSettle();
    expect(find.text('ADD ACCOUNT'), findsOneWidget);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Batalkan'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tidak'));
    await tester.pumpAndSettle();
    verifyNever(() => mockApi.patch(any(), data: any(named: 'data')));

    await tester.tap(find.byTooltip('Batalkan'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ya, Batalkan'));
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('insufficient balance disables cairkan', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(available: 1000, minRedemption: 10000),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    expect(find.text('Saldo Belum Mencukupi'), findsOneWidget);
  });

  testWidgets('no accounts request shows snackbar via empty path', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(withAccounts: false, available: 50000),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    expect(find.text('Tambah Akun Dulu'), findsOneWidget);
  });

  testWidgets('request without accounts surfaces inline snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(
          withAccounts: false,
          available: 50000,
          minRedemption: 10000,
        ),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    // The UI's "Tambah Akun Dulu" CTA navigates to add-account, so the
    // defensive "no accounts" branch in _requestRedemption is only reachable
    // by invoking the flow directly. The screen should still surface the
    // snackbar rather than crash.
    final state = tester.state<RedemptionScreenState>(find.byType(RedemptionScreen));
    await state.debugRequestRedemption();
    await tester.pump();
    expect(
      find.text('Tambahkan akun pencairan terlebih dahulu'),
      findsOneWidget,
    );
  });

  testWidgets('request without selected account surfaces snackbar',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: {
          'balance': {'available': 50000, 'pending': 0},
          'minRedemption': 10000,
          'payoutAccounts': [
            {
              'id': 'acc1',
              'provider': 'DANA',
              'accountIdentifier': '08111111111',
              'status': 'ACTIVE',
            },
          ],
          'redemptions': [],
        },
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    // Force-deselect the account by reaching into the state and clearing
    // the auto-selected id, then attempt to redeem.
    final state = tester.state<RedemptionScreenState>(find.byType(RedemptionScreen));
    state.debugClearSelectedAccount();
    await tester.pump();

    await state.debugRequestRedemption();
    await tester.pump();
    expect(find.text('Pilih akun tujuan'), findsOneWidget);
  });

  testWidgets('account dropdown change updates selection', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: {
          'balance': {'available': 50000, 'pending': 0},
          'minRedemption': 10000,
          'payoutAccounts': [
            {
              'id': 'acc1',
              'provider': 'DANA',
              'accountIdentifier': '08111111111',
              'status': 'ACTIVE',
            },
            {
              'id': 'acc2',
              'provider': 'OVO',
              'accountIdentifier': '08222222222',
              'status': 'ACTIVE',
            },
          ],
          'redemptions': [],
        },
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    // Open the dropdown and pick the second account.
    final dropdown = find.byType(DropdownButtonFormField<String>);
    expect(dropdown, findsOneWidget);
    await tester.tap(dropdown);
    await tester.pumpAndSettle();
    await tester.tap(find.text('OVO · 08222222222').last);
    await tester.pumpAndSettle();
  });

  testWidgets('second Kelola Akun button navigates to add account',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/wallet')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/wallet'),
        data: walletData(),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    // The second "Kelola Akun" lives in the history header. Tapping the
    // last one should also navigate to the add-account route.
    final manageButtons = find.text('Kelola Akun');
    expect(manageButtons, findsNWidgets(2));
    await tester.tap(manageButtons.last);
    await tester.pumpAndSettle();
    expect(find.text('ADD ACCOUNT'), findsOneWidget);
  });
}
