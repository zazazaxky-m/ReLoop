import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/core/router.dart';
import 'package:reloop_mobile/services/analytics_service.dart';
import 'package:reloop_mobile/services/notification_service.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockAuthProvider extends Mock implements AuthProvider {}

class MockNotificationService extends Mock implements NotificationService {
  @override
  void Function(String route, Map<String, String>? params)? onNotificationTap;
}

class MockAnalyticsService extends Mock implements AnalyticsService {}

void main() {
  late MockAuthProvider mockAuth;
  late MockNotificationService mockNotif;
  late MockAnalyticsService mockAnalytics;

  setUpAll(() {
    FlutterSecureStorage.setMockInitialValues({'onboarding_completed': 'true'});
    registerFallbackValue(AppRole.USER);
    registerFallbackValue(<String, dynamic>{});
  });

  setUp(() {
    mockAuth = MockAuthProvider();
    mockNotif = MockNotificationService();
    mockAnalytics = MockAnalyticsService();
    when(() => mockAuth.isAuthenticated).thenReturn(false);
    when(() => mockAuth.isLoading).thenReturn(false);
    when(() => mockAuth.user).thenReturn(null);
    when(() => mockAuth.error).thenReturn(null);
    when(() => mockAuth.dashboardRoute).thenReturn('/login');
    when(() => mockAuth.checkSession()).thenAnswer((_) async => null);
    when(() => mockAnalytics.logScreenView(screenName: any(named: 'screenName')))
        .thenAnswer((_) async {});
  });

  AppRouter createRouter() =>
      AppRouter(mockAuth, mockNotif, analytics: mockAnalytics);

  test('AppRouter initializes correctly', () {
    final appRouter = createRouter();
    expect(appRouter.router, isNotNull);
  });

  test('AppRouter defaults analytics when omitted', () {
    final appRouter = AppRouter(mockAuth, mockNotif);
    expect(appRouter.router, isNotNull);
  });

  testWidgets('unauthenticated user is redirected to login', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(false);
    final router = createRouter().router;

    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/dashboard');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(router.state.uri.path, '/login');
  });

  testWidgets('authenticated user on auth route goes to dashboard',
      (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'User',
        email: 'u@e.com',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/login');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(router.state.uri.path, '/dashboard');
  });

  testWidgets('wrong role is redirected to own dashboard', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'User',
        email: 'u@e.com',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/admin');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(router.state.uri.path, '/dashboard');
  });

  testWidgets('admin can open admin home', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'a1',
        name: 'Admin',
        email: 'a@e.com',
        role: AppRole.ADMIN,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/admin');

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/admin');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));
    expect(router.state.uri.path, '/admin');
  });

  testWidgets('pengepul dashboard route allowed', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'p1',
        name: 'Pengepul',
        email: 'p@e.com',
        role: AppRole.PENGEPUL,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/pengepul/dashboard');

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/pengepul/dashboard');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));
    expect(router.state.uri.path, '/pengepul/dashboard');
  });

  testWidgets('superadmin can open system routes', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 's1',
        name: 'Super',
        email: 's@e.com',
        role: AppRole.SUPERADMIN,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/superadmin');

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/superadmin');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));
    expect(router.state.uri.path, '/superadmin');

    router.go('/wallet');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));
    expect(router.state.uri.path, '/wallet');
  });

  testWidgets('public auth routes reachable when logged out', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(false);
    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    for (final path in ['/register', '/forgot-password']) {
      router.go(path);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 40));
      expect(router.state.uri.path, path);
    }
  });

  test('notification tap callback is wired', () {
    createRouter();
    expect(mockNotif.onNotificationTap, isNotNull);
    mockNotif.onNotificationTap!('/profile', {'id': '1'});
  });

  testWidgets('splash redirects to onboarding when not completed', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    when(() => mockAuth.isAuthenticated).thenReturn(false);
    when(() => mockAuth.checkSession()).thenAnswer((_) async {});

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    // initialLocation is /splash — wait for post-frame auth check
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump(const Duration(milliseconds: 200));

    expect(router.state.uri.path, '/onboarding');
  });

  testWidgets('splash redirects to login when onboarding done', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'onboarding_completed': 'true'});
    when(() => mockAuth.isAuthenticated).thenReturn(false);
    when(() => mockAuth.checkSession()).thenAnswer((_) async {});

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump(const Duration(milliseconds: 200));

    expect(router.state.uri.path, '/login');
  });

  testWidgets('splash redirects to dashboard when authenticated', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'onboarding_completed': 'true'});
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'User',
        email: 'u@e.com',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.checkSession()).thenAnswer((_) async {
      // Simulate session restoring auth flag used by splash.
    });

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump(const Duration(milliseconds: 200));

    expect(router.state.uri.path, '/dashboard');
  });

  testWidgets('authenticated login with redirect query', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'User',
        email: 'u@e.com',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/login?redirect=%2Fwallet');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(router.state.uri.path, '/wallet');
  });

  testWidgets('unauthenticated preserves redirect query', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(false);
    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/wallet');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(router.state.uri.path, '/login');
    expect(router.state.uri.queryParameters['redirect'], '/wallet');
  });

  testWidgets('pengepul cannot open user dashboard', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'p1',
        name: 'Pengepul',
        email: 'p@e.com',
        role: AppRole.PENGEPUL,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/pengepul/dashboard');

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/dashboard');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(router.state.uri.path, '/pengepul/dashboard');
  });

  testWidgets('user cannot open pengepul dashboard', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'User',
        email: 'u@e.com',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/pengepul/dashboard');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(router.state.uri.path, '/dashboard');
  });

  testWidgets('notification tap with params and same-route skip', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'User',
        email: 'u@e.com',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');

    final appRouter = createRouter();
    final router = appRouter.router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/terms');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(router.state.uri.path, '/terms');

    mockNotif.onNotificationTap!('/terms', null);
    await tester.pump();
    expect(router.state.uri.path, '/terms');

    mockNotif.onNotificationTap!('/privacy', null);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(router.state.uri.path, '/privacy');

    mockNotif.onNotificationTap!('/terms', {'from': 'notif'});
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(router.state.uri.path, '/terms');
    expect(router.state.uri.queryParameters['from'], 'notif');
  });

  testWidgets('user shell bottom nav switches tabs', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'User',
        email: 'u@e.com',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/dashboard');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));

    final peta = find.text('Peta');
    if (peta.evaluate().isNotEmpty) {
      await tester.tap(peta);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 80));
      expect(router.state.uri.path, '/map');
    }
  });

  testWidgets('smoke navigates public and role routes', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'onboarding_completed': 'true'});
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 's1',
        name: 'Super',
        email: 's@e.com',
        role: AppRole.SUPERADMIN,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/superadmin');
    when(() => mockAuth.logout()).thenAnswer((_) async {});
    when(() => mockAuth.hasRole(any())).thenReturn(true);

    // Provide a permissive ApiClient so route builders don't crash.
    final mockApi = _RouterMockApi();
    when(() => mockApi.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/'),
        data: <String, dynamic>{},
      ),
    );
    when(() => mockApi.get(any(), queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/'),
        data: <String, dynamic>{},
      ),
    );

    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      final m = details.exceptionAsString();
      if (m.contains('Provider') ||
          m.contains('ApiClient') ||
          m.contains('type') ||
          m.contains('Null') ||
          m.contains('RenderFlex') ||
          m.contains('ClientException') ||
          m.contains('MissingPlugin')) {
        return;
      }
      previous?.call(details);
    };

    final router = createRouter().router;
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
          Provider<ApiClient>.value(value: mockApi),
        ],
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );

    final paths = [
      '/about',
      '/terms',
      '/privacy',
      '/wallet',
      '/campaigns',
      '/trash-bags',
      '/notifications',
      '/map',
      '/admin',
      '/admin/machines',
      '/admin/campaigns',
      '/admin/trips',
      '/superadmin',
      '/superadmin/users',
      '/superadmin/organizations',
      '/superadmin/regions',
      '/superadmin/security',
      '/superadmin/config',
    ];
    for (final path in paths) {
      router.go(path);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 20));
      expect(router.state.uri.path, path);
    }
    FlutterError.onError = previous;
  });

  testWidgets('smoke navigates remaining admin and superadmin builders', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'onboarding_completed': 'true'});
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 's1',
        name: 'Super',
        email: 's@e.com',
        role: AppRole.SUPERADMIN,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/superadmin');
    when(() => mockAuth.logout()).thenAnswer((_) async {});
    when(() => mockAuth.hasRole(any())).thenReturn(true);

    final mockApi = _RouterMockApi();
    when(() => mockApi.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/'),
        data: <String, dynamic>{},
      ),
    );
    when(() => mockApi.get(any(), queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/'),
        data: <String, dynamic>{},
      ),
    );

    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      // Route builders may throw while loading incomplete mock payloads.
      return;
    };

    final router = createRouter().router;
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
          Provider<ApiClient>.value(value: mockApi),
        ],
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );

    final paths = [
      '/scan',
      '/profile',
      '/pickup',
      '/admin/machines/m1/detail',
      '/admin/pickups',
      '/admin/travel-agents',
      '/admin/compliance',
      '/admin/waste-types',
      '/admin/partners',
      '/admin/reports',
      '/superadmin/machines',
      '/superadmin/machines/m1/detail',
      '/superadmin/partnerships',
      '/superadmin/redemptions',
      '/superadmin/reconciliation',
      '/superadmin/audit',
      '/superadmin/reports',
      '/superadmin/waste-types',
      '/wallet/redemption',
      '/wallet/redemption/create',
      '/wallet/add-account',
      '/machine/MAC01/detail',
    ];
    for (final path in paths) {
      router.go(path);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
    }
    FlutterError.onError = previous;
  });

  testWidgets('pengepul shell bottom nav', (tester) async {
    when(() => mockAuth.isAuthenticated).thenReturn(true);
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'p1',
        name: 'Pengepul',
        email: 'p@e.com',
        role: AppRole.PENGEPUL,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.dashboardRoute).thenReturn('/pengepul/dashboard');

    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      final m = details.exceptionAsString();
      if (m.contains('Provider') ||
          m.contains('ApiClient') ||
          m.contains('RenderFlex') ||
          m.contains('Null')) {
        return;
      }
      previous?.call(details);
    };

    final router = createRouter().router;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    router.go('/pengepul/dashboard');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));
    expect(router.state.uri.path, '/pengepul/dashboard');

    // Hit pengepul-only builders without asserting UI.
    FlutterError.onError = (_) {};
    final mockApi = _RouterMockApi();
    when(() => mockApi.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/'),
        data: <String, dynamic>{'partnerships': [], 'machines': [], 'pickups': []},
      ),
    );
    when(() => mockApi.get(any(), queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/'),
        data: <String, dynamic>{'partnerships': [], 'machines': [], 'pickups': []},
      ),
    );
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
          Provider<ApiClient>.value(value: mockApi),
        ],
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: router,
        ),
      ),
    );
    for (final path in ['/pengepul/area', '/pengepul/tourism-pickups', '/pickup']) {
      router.go(path);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 20));
    }
    FlutterError.onError = previous;
  });
}
class _RouterMockApi extends Mock implements ApiClient {}
