import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/dashboard/pengepul_dashboard_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}
class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockApiClient mockApi;
  late MockAuthProvider mockAuth;

  setUp(() {
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'p1',
        name: 'Budi Santoso',
        email: 'budi@reloop.id',
        role: AppRole.PENGEPUL,
        status: 'ACTIVE',
      ),
    );
  });

  void stubDashboardApis({
    bool empty = false,
    bool throwError = false,
    Object? partnershipsData,
    List<Map<String, dynamic>>? pickups,
    List<Map<String, dynamic>>? machines,
  }) {
    if (throwError) {
      when(() => mockApi.get(any(), queryParameters: any(named: 'queryParameters')))
          .thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/pickups'),
          type: DioExceptionType.connectionError,
        ),
      );
      when(() => mockApi.get(any())).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/notifications'),
          type: DioExceptionType.connectionError,
        ),
      );
      return;
    }

    when(() => mockApi.get('/api/pickups', queryParameters: {'scope': 'collector'}))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups'),
        data: {
          'pickups': pickups ??
              (empty
              ? []
              : [
                  {
                    'id': 'pk1',
                    'status': 'ASSIGNED',
                    'machine': {'name': 'Mesin Mitra 1'},
                    'organization': {'name': 'Org Mitra'},
                  },
                  {
                    'id': 'pk2',
                    'status': 'COMPLETED',
                    'machine': {'name': 'Mesin Selesai'},
                    'organization': {'name': 'Org Mitra'},
                  },
                ]),
        },
      ),
    );
    when(() => mockApi.get('/api/public/machines', queryParameters: {'scope': 'partners'}))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/machines'),
        data: {
          'machines': machines ??
              (empty
              ? []
              : [
                  {
                    'id': 'm1',
                    'name': 'Mesin Penuh',
                    'status': 'FULL',
                    'fillLevelPercent': 98,
                    'organization': {'name': 'Mitra B'},
                  },
                  {
                    'id': 'm2',
                    'name': 'Mesin Online',
                    'status': 'ONLINE',
                    'fillLevelPercent': 40,
                    'organization': {'name': 'Mitra C'},
                  },
                ]),
        },
      ),
    );
    when(() => mockApi.get('/api/partnerships', queryParameters: {'status': 'ACTIVE'}))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/partnerships'),
        data: partnershipsData ??
            {
              'partnerships': empty
                  ? []
                  : [
                      {'id': 'ps1', 'status': 'ACTIVE'},
                      {'id': 'ps2', 'status': 'ACTIVE'},
                    ],
            },
      ),
    );
    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'unreadCount': 2, 'notifications': []},
      ),
    );
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        data: {'slides': []},
      ),
    );
  }

  Widget buildApp() {
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (_, __) => const PengepulDashboardScreen()),
        GoRoute(path: '/profile', builder: (_, __) => const Scaffold(body: Text('PROFILE'))),
        GoRoute(path: '/pickup', builder: (_, __) => const Scaffold(body: Text('PICKUP'))),
        GoRoute(
          path: '/pengepul/tourism-pickups',
          builder: (_, __) => const Scaffold(body: Text('TOURISM')),
        ),
        GoRoute(path: '/map', builder: (_, __) => const Scaffold(body: Text('MAP'))),
        GoRoute(
          path: '/pengepul/area',
          builder: (_, __) => const Scaffold(body: Text('AREA')),
        ),
        GoRoute(
          path: '/notifications',
          builder: (_, __) => const Scaffold(body: Text('NOTIF')),
        ),
      ],
    );

    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MaterialApp.router(
        theme: AppTheme.light,
        routerConfig: router,
      ),
    );
  }

  testWidgets('loads dashboard metrics and lists', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubDashboardApis();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.textContaining('Halo, Budi!'), findsOneWidget);
    expect(find.text('Tugas Pickup'), findsOneWidget);
    expect(find.text('Pickup Wisata'), findsOneWidget);
    expect(find.text('Ringkasan Operasional'), findsOneWidget);
    expect(find.text('Mesin Mitra 1'), findsOneWidget);
    expect(find.text('Mesin Penuh'), findsOneWidget);
    expect(find.text('98%'), findsOneWidget);
  });

  testWidgets('navigates quick actions', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubDashboardApis();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tugas Pickup'));
    await tester.pumpAndSettle();
    expect(find.text('PICKUP'), findsOneWidget);
  });

  testWidgets('navigates remaining actions and profile entry points', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubDashboardApis();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Pickup Wisata'));
    await tester.pumpAndSettle();
    expect(find.text('TOURISM'), findsOneWidget);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Peta Mesin'));
    await tester.pumpAndSettle();
    expect(find.text('MAP'), findsOneWidget);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Area Layanan'));
    await tester.pumpAndSettle();
    expect(find.text('AREA'), findsOneWidget);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Lihat semua'));
    await tester.pumpAndSettle();
    expect(find.text('PICKUP'), findsOneWidget);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Lihat peta'));
    await tester.pumpAndSettle();
    expect(find.text('MAP'), findsOneWidget);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Halo, Budi!'));
    await tester.pumpAndSettle();
    expect(find.text('PROFILE'), findsOneWidget);
  });

  testWidgets('shows empty task and machine rows', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubDashboardApis(empty: true);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada tugas pickup saat ini.'), findsOneWidget);
    expect(find.text('Tidak ada mesin penuh saat ini.'), findsOneWidget);
  });

  testWidgets('handles non-map partnerships and fallback task labels', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubDashboardApis(
      partnershipsData: <dynamic>[],
      pickups: [
        {
          'id': 'pk-org',
          'status': 'ASSIGNED',
          'organization': {'name': 'Org Fallback'},
        },
        {
          'id': 'pk-empty',
          'status': 'ASSIGNED',
        },
      ],
      machines: [
        {
          'id': 'm1',
          'name': 'Mesin Penuh',
          'status': 'FULL',
          'fillLevelPercent': 99,
        },
      ],
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Org Fallback'), findsWidgets);
    expect(find.text('Mesin'), findsOneWidget);
    expect(find.text('0'), findsOneWidget);
  });

  testWidgets('shows error and retry', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    stubDashboardApis(throwError: true);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Coba lagi'), findsOneWidget);

    // Recover
    mockApi = MockApiClient();
    stubDashboardApis(empty: true);
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    expect(find.textContaining('Halo, Budi!'), findsOneWidget);
  });
}
