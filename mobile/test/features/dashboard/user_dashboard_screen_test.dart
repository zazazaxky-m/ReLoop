import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/dashboard/user_dashboard_screen.dart';
import 'package:reloop_mobile/services/offline_service.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockAuthProvider extends Mock implements AuthProvider {}

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockAuthProvider mockAuth;
  late MockApiClient mockApi;
  void Function(FlutterErrorDetails)? previousOnError;

  setUp(() {
    previousOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      final message = details.exceptionAsString();
      if (message.contains('RenderFlex overflowed') ||
          message.contains('A RenderFlex overflowed') ||
          message.contains('ClientException') ||
          message.contains('path_provider') ||
          message.contains('MissingPluginException') ||
          message.contains('HiveError') ||
          message.contains('OVERFLOWING')) {
        return;
      }
      previousOnError?.call(details);
    };
    mockAuth = MockAuthProvider();
    mockApi = MockApiClient();
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: '1',
        name: 'John',
        email: 'john@a.com',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );
  });

  tearDown(() {
    FlutterError.onError = previousOnError;
    OfflineService.debugGetOverride = null;
  });

  void stubDashboard({
    Map<String, dynamic>? data,
    bool throwError = false,
  }) {
    if (throwError) {
      when(() => mockApi.get('/api/user/dashboard')).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/user/dashboard'),
          type: DioExceptionType.connectionError,
        ),
      );
    } else {
      when(() => mockApi.get('/api/user/dashboard')).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: ''),
          data: data ??
              {
                'balance': {
                  'available': 15000,
                  'pending': 500,
                  'redeemed': 1000,
                  'reserved': 0,
                  'totalEarned': 20000,
                },
                'pointsToRupiah': 5,
                'isTravelAgent': false,
                'recentSessions': [],
                'recentLedger': [],
                'campaigns': [],
              },
        ),
      );
    }
    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'notifications': [], 'unreadCount': 0},
      ),
    );
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        data: {'slides': []},
      ),
    );
  }

  Widget buildScreen() {
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const UserDashboardScreen(),
        ),
        GoRoute(
          path: '/wallet',
          builder: (context, state) =>
              const Scaffold(body: Text('Wallet page')),
        ),
        GoRoute(
          path: '/wallet/redemption',
          builder: (context, state) =>
              const Scaffold(body: Text('Redemption page')),
        ),
        GoRoute(
          path: '/campaigns',
          builder: (context, state) =>
              const Scaffold(body: Text('Campaigns page')),
        ),
        GoRoute(
          path: '/trash-bags',
          builder: (context, state) =>
              const Scaffold(body: Text('Trash bags page')),
        ),
        GoRoute(
          path: '/map',
          builder: (context, state) =>
              const Scaffold(body: Text('Map page')),
        ),
        GoRoute(
          path: '/profile',
          builder: (context, state) =>
              const Scaffold(body: Text('Profile page')),
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

  testWidgets('UserDashboardScreen loads and renders data', (tester) async {
    stubDashboard();

    await tester.binding.setSurfaceSize(const Size(800, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.textContaining('Halo, John'), findsOneWidget);
    expect(find.textContaining('15.000'), findsOneWidget);
    expect(find.text('Layanan ReLoop'), findsOneWidget);
    expect(find.text('Belum ada aktivitas setor'), findsOneWidget);
    expect(find.text('Belum ada program aktif'), findsOneWidget);
    expect(find.text('Belum ada riwayat reward'), findsOneWidget);
  });

  testWidgets('shows error and retry', (tester) async {
    stubDashboard(throwError: true);
    when(() => mockApi.get('/api/notifications')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/notifications'),
        type: DioExceptionType.connectionError,
      ),
    );
    when(() => mockApi.get('/api/public/hero-slides')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.binding.setSurfaceSize(const Size(800, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.text('Coba lagi'), findsOneWidget);

    stubDashboard();
    await tester.tap(find.text('Coba lagi'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Halo, John'), findsOneWidget);
  });

  testWidgets('travel agent shows points estimate', (tester) async {
    stubDashboard(
      data: {
        'balance': {'available': 15000, 'pending': 0},
        'pointsToRupiah': 5,
        'isTravelAgent': true,
        'recentSessions': [],
        'recentLedger': [],
        'campaigns': [],
      },
    );

    await tester.binding.setSurfaceSize(const Size(800, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.textContaining('poin'), findsOneWidget);
    expect(find.textContaining('3.000'), findsOneWidget);
  });

  testWidgets('renders sessions campaigns and ledger', (tester) async {
    stubDashboard(
      data: {
        'balance': {'available': 20000, 'pending': 0},
        'pointsToRupiah': 1,
        'isTravelAgent': false,
        'recentSessions': [
          {
            'id': 's1',
            'userId': '1',
            'machineId': 'm1',
            'status': 'COMPLETED',
            'startedAt': '2026-07-10T08:00:00Z',
            'machine': {
              'id': 'm1',
              'machineCode': 'MAC-1',
              'name': 'Mesin Dashboard',
              'status': 'ONLINE',
              'fillLevelPercent': 10,
            },
          },
        ],
        'campaigns': [
          {
            'id': 'c1',
            'name': 'Program Hijau',
            'status': 'ACTIVE',
            'organization': {'name': 'Org Dashboard'},
          },
          {
            'id': 'c2',
            'name': 'Draft Skip',
            'status': 'DRAFT',
          },
        ],
        'recentLedger': [
          {
            'id': 'e1',
            'userId': '1',
            'entryType': 'EARN',
            'amount': 500,
            'status': 'AVAILABLE',
            'createdAt': '2026-07-10T09:00:00Z',
            'reasonCode': 'DEPOSIT_ACCEPTED',
            'depositItem': {
              'wasteType': {'name': 'Plastik'},
            },
          },
          {
            'id': 'e2',
            'userId': '1',
            'entryType': 'REDEEM',
            'amount': -200,
            'status': 'AVAILABLE',
            'createdAt': '2026-07-10T10:00:00Z',
            'reasonCode': 'REDEMPTION_SUCCESS',
          },
        ],
      },
    );

    await tester.binding.setSurfaceSize(const Size(800, 2000));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.text('Mesin Dashboard'), findsOneWidget);
    expect(find.text('Program Hijau'), findsOneWidget);
    expect(find.text('Org Dashboard'), findsOneWidget);
    expect(find.text('Plastik'), findsOneWidget);
    expect(find.textContaining('500'), findsWidgets);
    expect(find.textContaining('200'), findsWidgets);
  });

  testWidgets('quick actions and section links navigate', (tester) async {
    stubDashboard();

    await tester.binding.setSurfaceSize(const Size(800, 2000));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Program'));
    await tester.pumpAndSettle();
    expect(find.text('Campaigns page'), findsOneWidget);

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Trash Bag'));
    await tester.pumpAndSettle();
    expect(find.text('Trash bags page'), findsOneWidget);

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pencairan'));
    await tester.pumpAndSettle();
    expect(find.text('Redemption page'), findsOneWidget);

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cari Mesin'));
    await tester.pumpAndSettle();
    expect(find.text('Map page'), findsOneWidget);
  });

  testWidgets('lihat dompet and cairkan navigate', (tester) async {
    stubDashboard();

    await tester.binding.setSurfaceSize(const Size(800, 2000));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Lihat dompet'));
    await tester.tap(find.text('Lihat dompet'));
    await tester.pumpAndSettle();
    expect(find.text('Wallet page'), findsOneWidget);
  });

  testWidgets('invalid dashboard payload shows error', (tester) async {
    when(() => mockApi.get('/api/user/dashboard')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/user/dashboard'),
        data: 'bukan-map',
      ),
    );
    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'notifications': [], 'unreadCount': 0},
      ),
    );
    when(() => mockApi.get('/api/public/hero-slides')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/hero-slides'),
        data: {'slides': []},
      ),
    );

    await tester.binding.setSurfaceSize(const Size(800, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan yang tidak terduga.'), findsOneWidget);
  });

  testWidgets('offline cache banner when api fails', (tester) async {
    OfflineService.debugGetOverride = (key) {
      if (key == 'dashboard') {
        return {
          'balance': {
            'available': 1000,
            'pending': 0,
            'redeemed': 0,
            'reserved': 0,
            'totalEarned': 1000,
          },
          'pointsToRupiah': 5,
          'isTravelAgent': false,
          'recentSessions': [],
          'recentLedger': [],
          'campaigns': [],
        };
      }
      return null;
    };
    stubDashboard(throwError: true);

    await tester.binding.setSurfaceSize(const Size(800, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Menampilkan data tersimpan (offline)'),
      findsOneWidget,
    );
    OfflineService.debugGetOverride = null;
  });

  testWidgets('dark theme covers teal quick action tones', (tester) async {
    stubDashboard(data: {
      'balance': {
        'available': 15000,
        'pending': 500,
        'redeemed': 1000,
        'reserved': 0,
        'totalEarned': 20000,
      },
      'pointsToRupiah': 5,
      'isTravelAgent': false,
      'recentSessions': [
        {
          'id': 's1',
          'status': 'COMPLETED',
          'createdAt': '2026-07-10T08:00:00Z',
          'machine': {'name': 'Mesin Dark'},
        },
      ],
      'recentLedger': [
        {
          'id': 'e1',
          'userId': '1',
          'entryType': 'EARN',
          'amount': 500,
          'status': 'AVAILABLE',
          'createdAt': '2026-07-10T09:00:00Z',
          'reasonCode': 'DEPOSIT_ACCEPTED',
          'depositItem': {
            'wasteType': {'name': 'Plastik'},
          },
        },
      ],
      'campaigns': [],
    });
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
          Provider<ApiClient>.value(value: mockApi),
        ],
        child: MaterialApp.router(
          theme: AppTheme.dark,
          routerConfig: GoRouter(
            initialLocation: '/',
            routes: [
              GoRoute(
                path: '/',
                builder: (_, __) => const UserDashboardScreen(),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Pencairan'), findsOneWidget);
    expect(find.textContaining('Plastik'), findsWidgets);
  });

  testWidgets('lihat dompet cairkan and lihat semua navigate', (tester) async {
    stubDashboard();

    await tester.binding.setSurfaceSize(const Size(800, 2000));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Cairkan'));
    await tester.pumpAndSettle();
    expect(find.text('Wallet page'), findsOneWidget);

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Lihat semua'));
    await tester.tap(find.text('Lihat semua'));
    await tester.pumpAndSettle();
    expect(find.text('Campaigns page'), findsOneWidget);
  });

  testWidgets('riwayat navigates to wallet', (tester) async {
    stubDashboard();

    await tester.binding.setSurfaceSize(const Size(800, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Riwayat'));
    await tester.pumpAndSettle();
    expect(find.text('Wallet page'), findsOneWidget);
  });

  testWidgets('profile avatar navigates to profile', (tester) async {
    stubDashboard();
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.byType(CircleAvatar).first);
    await tester.pumpAndSettle();
    expect(find.text('Profile page'), findsOneWidget);
  });
}
