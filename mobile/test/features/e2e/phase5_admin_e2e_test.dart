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
import 'package:reloop_mobile/shared/widgets/quick_action.dart';

import '../../helpers/e2e_helpers.dart';
import 'package:shared_preferences/shared_preferences.dart';

ApiClient createMockApiClient() {
  final client = ApiClient(baseUrl: 'http://localhost');
  client.dio.interceptors.add(InterceptorsWrapper(
    onRequest: (options, handler) async {
      final path = options.path;
      if (path == '/api/auth/login') {
         return handler.resolve(Response(
           requestOptions: options,
           data: { 'token': 'mock_token', 'user': { 'id': '2', 'name': 'Pengepul', 'email': 'pengepul@reloop.id', 'role': 'PENGEPUL', 'status': 'ACTIVE' } }
         ));
      }
      if (path == '/api/auth/me') {
         return handler.reject(DioException(
           requestOptions: options,
           response: Response(requestOptions: options, statusCode: 401, data: {'error': 'Unauthorized'}),
           type: DioExceptionType.badResponse,
         ));
      }
      if (path == '/api/mobile/overview') {
         return handler.resolve(Response(
           requestOptions: options,
           statusCode: 200,
           data: {
             'machines': [],
             'pickups': [],
             'campaignCount': 3,
             'depositCount': 10,
             'partnershipCount': 5,
           }
         ));
      }
      if (path == '/api/admin/system/metrics') {
         return handler.resolve(Response(
           requestOptions: options,
           statusCode: 200,
           data: {
             'organizationCount': 10,
             'machineCount': 50,
             'userCount': 100,
             'rewardAvailable': 10000,
             'securitySummary': {'alerts24h': 2},
           }
         ));
      }
      return handler.resolve(Response(requestOptions: options, statusCode: 200, data: {}));
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

  group('E2E Testing - Phase 5 (Admin & Superadmin Workflows)', () {
    testWidgets('T1: Admin Flow', (tester) async {
      await mockNetworkImagesFor(() async {
        await runE2EApp(tester);
        await tester.pumpAndSettle();
        
        // Modify mock login for ADMIN
        final apiClient = Provider.of<ApiClient>(tester.element(find.byType(MaterialApp)), listen: false);
        apiClient.dio.interceptors.insert(0, InterceptorsWrapper(
          onRequest: (options, handler) {
            if (options.path == '/api/auth/login') {
               return handler.resolve(Response(
                 requestOptions: options,
                 statusCode: 200,
                 data: { 'token': 'mock_token', 'user': { 'id': '3', 'name': 'Admin User', 'email': 'admin@reloop.id', 'role': 'ADMIN', 'status': 'ACTIVE' } }
               ));
            }
            handler.next(options);
          }
        ));
        
        // Login sebagai admin
        await loginAs(tester, 'admin@reloop.id', 'password123');

        // Tunggu load API
        await tester.pump(const Duration(seconds: 1));
        await tester.pumpAndSettle();

        // Pastikan masuk ke Dashboard Admin
        expect(find.text('Total Mesin', skipOffstage: false), findsWidgets);
        expect(find.text('Campaign Aktif', skipOffstage: false), findsWidgets);


        // Tap Campaign quick action
        final campaignButton = find.text('Campaign', skipOffstage: false);
        await tester.scrollUntilVisible(campaignButton, 50.0, scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();
        await tester.tap(campaignButton.first);
        await tester.pumpAndSettle();

        // Pastikan masuk ke halaman Campaign
        expect(find.textContaining('Campaign', skipOffstage: false), findsWidgets);
        
        // Kembali ke dashboard
        final context = tester.element(find.byType(Scaffold).last);
        if (context.canPop()) {
          context.pop();
        } else {
          context.go('/admin');
        }
        await tester.pumpAndSettle();

        await logoutUser(tester);
      });
    });

    testWidgets('T2: Superadmin Flow', (tester) async {
      await mockNetworkImagesFor(() async {
        await runE2EApp(tester);
        await tester.pumpAndSettle();
        
        // Modify mock login for SUPERADMIN
        final apiClient = Provider.of<ApiClient>(tester.element(find.byType(MaterialApp)), listen: false);
        apiClient.dio.interceptors.insert(0, InterceptorsWrapper(
          onRequest: (options, handler) {
            if (options.path == '/api/auth/login') {
               return handler.resolve(Response(
                 requestOptions: options,
                 statusCode: 200,
                 data: { 'token': 'mock_token', 'user': { 'id': '4', 'name': 'Super Admin', 'email': 'superadmin@reloop.id', 'role': 'SUPERADMIN', 'status': 'ACTIVE' } }
               ));
            }
            handler.next(options);
          }
        ));

        // Login sebagai superadmin
        await loginAs(tester, 'superadmin@reloop.id', 'password123');
        
        // Tunggu API
        await tester.pump(const Duration(seconds: 1));
        await tester.pumpAndSettle();

        // Pastikan masuk ke halaman Dashboard Superadmin
        expect(find.text('Layanan ReLoop', skipOffstage: false), findsWidgets);


        // Tap Pengguna quick action
        final usersButton = find.descendant(
          of: find.byType(QuickAction),
          matching: find.text('Pengguna', skipOffstage: false),
        );
        await tester.scrollUntilVisible(usersButton, 50.0, scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();
        await tester.tap(usersButton);
        await tester.pumpAndSettle();

        // Pastikan masuk ke halaman Users
        expect(find.textContaining('Pengguna', skipOffstage: false), findsWidgets);

        // Kembali
        final context = tester.element(find.byType(Scaffold).last);
        if (context.canPop()) {
          context.pop();
        } else {
          context.go('/superadmin');
        }
        await tester.pumpAndSettle();

        await logoutUser(tester);
      });
    });
  });
}
