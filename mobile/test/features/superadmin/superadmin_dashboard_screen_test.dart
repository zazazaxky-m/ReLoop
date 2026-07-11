import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/superadmin/superadmin_dashboard_screen.dart';
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
        name: 'Super Admin',
        email: 'super@example.com',
        role: AppRole.SUPERADMIN,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.logout()).thenAnswer((_) async {});
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        data: {'slides': <dynamic>[]},
      ),
    );
  });

  tearDown(() {
    FlutterError.onError = previousOnError;
  });

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
            initialLocation: '/superadmin',
            routes: [
              for (final path in [
                '/superadmin',
                '/superadmin/users',
                '/superadmin/security',
                '/superadmin/redemptions',
                '/superadmin/partnerships',
                '/superadmin/reconciliation',
                '/superadmin/regions',
                '/superadmin/waste-types',
                '/superadmin/machines',
                '/superadmin/audit',
                '/superadmin/reports',
                '/superadmin/config',
                '/profile',
              ])
                GoRoute(
                  path: path,
                  builder: (_, __) => path == '/superadmin'
                      ? const SuperadminDashboardScreen()
                      : Scaffold(body: Text('$path page')),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Map<String, dynamic> overviewData({int alerts24h = 0}) => {
        'organizationCount': 3,
        'machineCount': 12,
        'userCount': 40,
        'rewardAvailable': 150000,
        'depositCount': 99,
        'pendingPartners': 2,
        'minRedemption': 10000,
        'securitySummary': {
          'alerts24h': alerts24h,
          'fraud7d': 0,
          'vandalism7d': 0,
        },
      };

  testWidgets('renders summary metrics and quick actions', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: overviewData(),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Dashboard Superadmin'), findsOneWidget);
    expect(find.textContaining('Halo, Super'), findsOneWidget);
    expect(find.text('Organisasi'), findsWidgets);
    expect(find.text('Layanan ReLoop'), findsOneWidget);
    expect(find.text('Pengguna'), findsWidgets);
    expect(find.text('Operasional'), findsOneWidget);
    expect(find.text('Ekspor Laporan'), findsOneWidget);
    expect(find.text('Deposit'), findsOneWidget);
  });

  testWidgets('shows alert banner and navigates to security', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: overviewData(alerts24h: 5),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Peringatan Fraud & Vandalisme'), findsOneWidget);
    expect(find.textContaining('5 alert'), findsOneWidget);

    await tester.tap(find.text('Buka log'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('/superadmin/security page'), findsOneWidget);
  });

  testWidgets('quick action navigates to users', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: overviewData(),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.text('Akun & role'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('/superadmin/users page'), findsOneWidget);
  });

  testWidgets('all remaining quick actions navigate', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: overviewData(),
      ),
    );

    final targets = <String, String>{
      'Approval mitra': '/superadmin/partnerships page',
      'Pencairan': '/superadmin/redemptions page',
      'Cek keuangan': '/superadmin/reconciliation page',
      'Struktur area': '/superadmin/regions page',
      'Sampah & poin': '/superadmin/waste-types page',
      'Semua unit': '/superadmin/machines page',
      'Jejak aktivitas': '/superadmin/audit page',
      'Ekspor global': '/superadmin/reports page',
      'Atur slider': '/superadmin/config page',
      'Log fraud': '/superadmin/security page',
    };

    for (final entry in targets.entries) {
      await tester.pumpWidget(buildApp());
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      await tester.ensureVisible(find.text(entry.key));
      await tester.tap(find.text(entry.key));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text(entry.value), findsOneWidget);
    }
  });

  testWidgets('shows retry on load error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/overview')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/mobile/overview'),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba lagi'), findsOneWidget);

    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: overviewData(),
      ),
    );
    await tester.tap(find.text('Coba lagi'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('Halo, Super'), findsOneWidget);
  });

  testWidgets('export deposit shows snackbar on failure', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2400));
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: overviewData(),
      ),
    );
    final mockDio = Dio();
    when(() => mockApi.dio).thenReturn(mockDio);

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.scrollUntilVisible(
      find.text('Deposit', skipOffstage: false),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Deposit'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.byType(SnackBar), findsOneWidget);
  });
}
