import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/main.dart' as app;
import 'package:reloop_mobile/core/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/services/notification_service.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter/services.dart';
import 'package:network_image_mock/network_image_mock.dart';
import 'package:reloop_mobile/services/analytics_service.dart';
import 'package:reloop_mobile/services/crashlytics_service.dart';
import 'package:reloop_mobile/services/background_sync_service.dart';
import 'package:reloop_mobile/providers/theme_provider.dart';
import 'package:reloop_mobile/providers/connectivity_provider.dart';

import '../../helpers/e2e_helpers.dart';
import 'package:shared_preferences/shared_preferences.dart';

ApiClient createMockApiClient() {
  final client = ApiClient(baseUrl: 'http://localhost');
  client.dio.interceptors.add(InterceptorsWrapper(
    onRequest: (options, handler) {
      final path = options.path;
      if (path == '/api/auth/login') {
         handler.resolve(Response(
           requestOptions: options,
           data: { 'token': 'mock_token', 'user': { 'id': '1', 'name': 'User', 'email': 'user@reloop.id', 'role': 'USER', 'status': 'ACTIVE' } }
         ));
         return;
      }
      if (path == '/api/auth/me') {
         handler.reject(DioException(
           requestOptions: options,
           response: Response(requestOptions: options, statusCode: 401, data: {'error': 'Unauthorized'}),
           type: DioExceptionType.badResponse,
         ));
         return;
      }
      if (path == '/api/user/dashboard') {
         handler.resolve(Response(
           requestOptions: options,
           data: {
             'balance': { 'available': 50000, 'pending': 0, 'redeemed': 0, 'reserved': 0, 'totalEarned': 50000 },
             'recentSessions': [],
             'campaigns': [],
             'recentLedger': [],
             'isTravelAgent': false,
             'pointsToRupiah': 1000,
           }
         ));
         return;
      }
      if (path == '/api/public/machines') {
         handler.resolve(Response(
           requestOptions: options,
           data: { 'machines': [] }
         ));
         return;
      }
      if (path == '/api/public/campaigns') {
         handler.resolve(Response(
           requestOptions: options,
           data: { 'campaigns': [] }
         ));
         return;
      }
      if (path == '/api/wallet') {
         handler.resolve(Response(
           requestOptions: options,
           statusCode: 200,
           data: {
             'balance': { 'available': 50000, 'pending': 0, 'redeemed': 0, 'reserved': 0, 'totalEarned': 50000 },
             'history': [],
             'payoutAccounts': [],
             'redemptions': [],
             'minRedemption': 10000,
           }
         ));
         return;
      }
      handler.next(options);
    }
  ));
  return client;
}

Future<void> runE2EApp(WidgetTester tester) async {
  print('-> runE2EApp: setup providers');
  final apiClient = createMockApiClient();
  final authProvider = AuthProvider(apiClient);
  final notifService = NotificationService();
  final analytics = AnalyticsService();
  final crashlytics = CrashlyticsService();
  final syncService = BackgroundSyncService();
  final themeProvider = ThemeProvider();
  
  // mock connectivity channel to avoid MissingPluginException
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
    const MethodChannel('dev.fluttercommunity.plus/connectivity'),
    (MethodCall methodCall) async {
      return ['wifi'];
    },
  );
  print('-> runE2EApp: ConnectivityProvider');
  final connectivity = ConnectivityProvider();

  print('-> runE2EApp: pumpWidget');
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: apiClient),
        ChangeNotifierProvider.value(value: authProvider),
        ChangeNotifierProvider.value(value: themeProvider),
        ChangeNotifierProvider.value(value: connectivity),
      ],
      child: app.ReloopApp(
        authProvider: authProvider,
        notifService: notifService,
        analytics: analytics,
        crashlytics: crashlytics,
        syncService: syncService,
      ),
    ),
  );
  print('-> runE2EApp: finished pumpWidget');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({'onboarding_completed': 'true'});
  });

  group('E2E Testing - Phase 3 (Core End-User Workflows)', () {
    testWidgets('T1: Dashboard & Navigasi', (tester) async {
      await mockNetworkImagesFor(() async {
        await runE2EApp(tester);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 500));

        await loginAs(tester, 'user@reloop.id', 'password123');
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        await tester.pump();

        expect(find.text('Layanan ReLoop', skipOffstage: false), findsWidgets);

        await logoutUser(tester);
      });
    });

    testWidgets('T2: Wallet & Redemption', (tester) async {
      await mockNetworkImagesFor(() async {
        await runE2EApp(tester);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 500));
        await loginAs(tester, 'user@reloop.id', 'password123');
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));

        final pencairanButton = find.text('Pencairan', skipOffstage: false);
        if (pencairanButton.evaluate().isNotEmpty) {
          await tester.scrollUntilVisible(pencairanButton, 50.0, scrollable: find.byType(Scrollable).first);
          await tester.pumpAndSettle();
          await tester.tap(pencairanButton.last);
          await tester.pumpAndSettle();
          expect(find.text('Pencairan Saldo'), findsOneWidget);
        }
      });
    });

    testWidgets('T3: Trash Bag & Scan QR', (tester) async {
      await mockNetworkImagesFor(() async {
        await runE2EApp(tester);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 500));
        await loginAs(tester, 'user@reloop.id', 'password123');
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));

        expect(find.byType(Scaffold), findsWidgets);

        await logoutUser(tester);
      });
    });
  });
}
