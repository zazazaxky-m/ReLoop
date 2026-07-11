import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/superadmin/superadmin_reconciliation_screen.dart';
import 'package:reloop_mobile/services/offline_service.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockApiClient mockApi;
  late MockAuthProvider mockAuth;
  void Function(FlutterErrorDetails)? previousOnError;

  setUp(() {
    previousOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      final message = details.exceptionAsString();
      if (message.contains('RenderFlex overflowed') ||
          message.contains('A RenderFlex overflowed') ||
          message.contains('ListTile background color')) {
        return;
      }
      previousOnError?.call(details);
    };
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'Super',
        email: 'super@example.com',
        role: AppRole.SUPERADMIN,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.logout()).thenAnswer((_) async {});
  });

  tearDown(() {
    FlutterError.onError = previousOnError;
    OfflineService.debugGetOverride = null;
  });

  Future<void> settle(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  }

  Widget buildApp() {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(0.85)),
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: GoRouter(
            initialLocation: '/superadmin/reconciliation',
            routes: [
              GoRoute(
                path: '/superadmin/reconciliation',
                builder: (_, __) => const SuperadminReconciliationScreen(),
              ),
              GoRoute(
                path: '/profile',
                builder: (_, __) => const Scaffold(body: Text('profile')),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Map<String, dynamic> reportData({bool discrepancy = false}) => {
        'totalOutstanding': 100000,
        'totalEarnPending': 5000,
        'ledgerRedeemed': 20000,
        'redemptionSuccessTotal': discrepancy ? 15000 : 20000,
        'ledgerReserved': 3000,
        'redemptionInFlightTotal': 3000,
        'redeemedDiscrepancy': discrepancy ? 5000 : 0,
        'reservedDiscrepancy': 0,
        'hasDiscrepancy': discrepancy,
        'generatedAt': '2026-07-10T00:00:00.000Z',
        'organizations': [
          {
            'organizationId': 'o1',
            'organizationName': 'Org A',
            'outstanding': 40000,
            'earnPending': 1000,
            'redeemed': 5000,
          },
        ],
      };

  testWidgets('renders reconciliation metrics and org cards', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    when(() => mockApi.get('/api/reports/reconciliation')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/reports/reconciliation'),
        data: {'report': reportData()},
      ),
    );

    await tester.pumpWidget(buildApp());
    await settle(tester);

    expect(find.text('Rekonsiliasi Keuangan'), findsOneWidget);
    expect(find.text('Total liabilitas'), findsOneWidget);
    expect(find.text('Ledger cocok dengan pencairan'), findsOneWidget);
    expect(find.text('Org A'), findsOneWidget);
  });

  testWidgets('shows discrepancy banner when mismatched', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    when(() => mockApi.get('/api/reports/reconciliation')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/reports/reconciliation'),
        data: {'report': reportData(discrepancy: true)},
      ),
    );

    await tester.pumpWidget(buildApp());
    await settle(tester);

    expect(find.text('Selisih rekonsiliasi terdeteksi'), findsOneWidget);
  });

  testWidgets('shows retry when API fails', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/reports/reconciliation')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/reports/reconciliation'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/reports/reconciliation'),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(buildApp());
    await settle(tester);

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba lagi'), findsOneWidget);
  });

  testWidgets('offline banner when cache available', (tester) async {
    OfflineService.debugGetOverride = (key) {
      if (key == 'reconciliation') {
        return reportData()..['organizations'] = <Map<String, dynamic>>[];
      }
      return null;
    };
    when(() => mockApi.get('/api/reports/reconciliation')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/reports/reconciliation'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await settle(tester);

    expect(find.textContaining('Menampilkan data tersimpan (offline)'), findsOneWidget);
    expect(find.text('Belum ada data ledger.'), findsOneWidget);
    OfflineService.debugGetOverride = null;
  });
}
