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
      if (path == '/api/pickups') {
         return handler.resolve(Response(
           requestOptions: options,
           statusCode: 200,
           data: { 'pickups': [] }
         ));
      }
      if (path == '/api/public/machines') {
         return handler.resolve(Response(
           requestOptions: options,
           statusCode: 200,
           data: { 'machines': [] }
         ));
      }
      if (path == '/api/partnerships') {
         return handler.resolve(Response(
           requestOptions: options,
           statusCode: 200,
           data: { 'partnerships': [] }
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

  group('E2E Testing - Phase 4 (Pengepul Workflows)', () {
    testWidgets('T1: Login & Pengepul Dashboard', (tester) async {
      await mockNetworkImagesFor(() async {
        await runE2EApp(tester);
        await tester.pumpAndSettle();
        
        // Login sebagai pengepul
        await loginAs(tester, 'pengepul@reloop.id', 'password123');

        // Tunggu sedikit ekstra in case API futures belum ter-resolve ke UI
        await tester.pump(const Duration(seconds: 1));
        await tester.pumpAndSettle();

        // Pastikan masuk ke halaman Dashboard Pengepul
        expect(find.text('Ringkasan Operasional', skipOffstage: false), findsWidgets);
        expect(find.text('Tugas aktif', skipOffstage: false), findsWidgets);
        
        await logoutUser(tester);
      });
    });

    testWidgets('T2: Pengepul Pickup Flow', (tester) async {
      await mockNetworkImagesFor(() async {
        await runE2EApp(tester);
        await tester.pumpAndSettle();
        await loginAs(tester, 'pengepul@reloop.id', 'password123');
        
        // Klik menu Tugas Pickup
        final pickupButton = find.text('Tugas Pickup', skipOffstage: false).first;
        await tester.scrollUntilVisible(pickupButton, 50.0, scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();
        await tester.tap(pickupButton);
        await tester.pumpAndSettle();

        // Pastikan masuk ke halaman Pickup
        expect(find.textContaining('Tugas Pickup', skipOffstage: false), findsWidgets);

        // Kembali
        final context = tester.element(find.byType(Scaffold).last);
        if (context.canPop()) {
          context.pop();
        } else {
          context.go('/pengepul/dashboard');
        }
        await tester.pumpAndSettle();

        await logoutUser(tester);
      });
    });
  });
}
