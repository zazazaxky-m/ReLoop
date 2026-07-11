import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_dashboard_screen.dart';
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
          message.contains('ListTile background color or ink splashes may be invisible.')) {
        return;
      }
      previousOnError?.call(details);
    };
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'Admin',
        email: 'admin@example.com',
        role: AppRole.ADMIN,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.hasRole(AppRole.SUPERADMIN)).thenReturn(false);
    when(() => mockAuth.logout()).thenAnswer((_) async {});
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
            initialLocation: '/admin',
            routes: [
              GoRoute(
                path: '/admin',
                builder: (context, state) => const AdminDashboardScreen(),
              ),
              GoRoute(
                path: '/admin/campaigns',
                builder: (context, state) =>
                    const Scaffold(body: Text('Campaigns page')),
              ),
              GoRoute(
                path: '/admin/partners',
                builder: (context, state) =>
                    const Scaffold(body: Text('Partners page')),
              ),
              GoRoute(
                path: '/admin/waste-types',
                builder: (context, state) =>
                    const Scaffold(body: Text('Waste types page')),
              ),
              GoRoute(
                path: '/admin/trips',
                builder: (context, state) =>
                    const Scaffold(body: Text('Trips page')),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Map<String, dynamic> overviewData() => {
        'machines': [
          {
            'id': 'm1',
            'name': 'Mesin Dashboard',
            'machineCode': 'MAC-D1',
            'status': 'FULL',
            'fillLevelPercent': 90,
          },
          {
            'id': 'm2',
            'name': 'Mesin Offline',
            'machineCode': 'MAC-D2',
            'status': 'OFFLINE',
            'fillLevelPercent': 20,
          },
        ],
        'pickups': [
          {
            'status': 'REQUESTED',
            'notes': 'Ambil segera',
            'machine': {'name': 'Pickup Mesin A'},
            '_count': {'items': 3},
          },
        ],
        'campaignCount': 2,
        'depositCount': 15,
        'partnershipCount': 4,
      };

  DioException serverError(String path) => DioException(
        requestOptions: RequestOptions(path: path),
        response: Response(
          requestOptions: RequestOptions(path: path),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      );

  testWidgets('loads overview metrics and lists', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: overviewData(),
      ),
    );
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        data: {'slides': []},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Dashboard Admin'), findsOneWidget);
    expect(find.text('Total Mesin'), findsOneWidget);
    expect(find.text('Mesin Penuh'), findsOneWidget);
    expect(find.text('Perlu Perhatian'), findsOneWidget);
    expect(find.text('Campaign Aktif'), findsOneWidget);
    expect(find.text('Sesi Selesai'), findsOneWidget);
    expect(find.text('Mitra Aktif'), findsOneWidget);
    expect(find.text('Mesin Dashboard'), findsOneWidget);
    expect(find.text('Pickup Mesin A'), findsOneWidget);
    expect(find.textContaining('Total sesi selesai organisasi: 15'), findsOneWidget);
    expect(find.text('Campaign'), findsOneWidget);
    expect(find.text('Mitra'), findsOneWidget);
  });

  testWidgets('empty machines and pickups show empty copy', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: {
          'machines': [],
          'pickups': [],
          'campaignCount': 0,
          'depositCount': 0,
          'partnershipCount': 0,
        },
      ),
    );
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        data: {'slides': []},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada mesin.'), findsOneWidget);
    expect(find.text('Tidak ada pickup aktif.'), findsOneWidget);
  });

  testWidgets('quick action navigates to campaigns', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: overviewData(),
      ),
    );
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        data: {'slides': []},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Campaign'));
    await tester.pumpAndSettle();

    expect(find.text('Campaigns page'), findsOneWidget);
  });

  testWidgets('quick actions navigate to mitra waste and trip', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: overviewData()
          ..['machines'] = [
            {
              'id': 'm1',
              'name': 'Mesin Mid',
              'machineCode': 'MAC-M',
              'status': 'ONLINE',
              'fillLevelPercent': 60,
            },
          ],
      ),
    );
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        data: {'slides': []},
      ),
    );

    final targets = {
      'Mitra': 'Partners page',
      'Jenis & Tarif': 'Waste types page',
      'Trip': 'Trips page',
    };
    for (final e in targets.entries) {
      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text(e.key));
      await tester.tap(find.text(e.key));
      await tester.pumpAndSettle();
      expect(find.text(e.value), findsOneWidget);
    }
  });

  testWidgets('shows retry state on error and reloads', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    var calls = 0;
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer((_) async {
      calls++;
      if (calls == 1) throw serverError('/api/mobile/overview');
      return Response(
        requestOptions: RequestOptions(path: '/api/mobile/overview'),
        data: overviewData(),
      );
    });
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        data: {'slides': []},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);

    await tester.tap(find.text('Coba Lagi'));
    await tester.pumpAndSettle();

    expect(find.text('Mesin Dashboard'), findsOneWidget);
  });
}
