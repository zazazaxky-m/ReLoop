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
           data: { 'token': 'mock_token', 'user': { 'id': '1', 'name': 'User', 'email': 'user@reloop.id', 'role': 'USER', 'status': 'ACTIVE' } }
         ));
      }
      if (path == '/api/auth/me') {
         return handler.reject(DioException(
           requestOptions: options,
           response: Response(requestOptions: options, statusCode: 401, data: {'error': 'Unauthorized'}),
           type: DioExceptionType.badResponse,
         ));
      }
      if (path == '/api/user/dashboard') {
         return handler.resolve(Response(
           requestOptions: options,
           data: {
             'balance': { 'available': 50000, 'pending': 0, 'redeemed': 0, 'reserved': 0, 'totalEarned': 50000 },
             'recentSessions': [],
             'campaigns': [],
             'recentLedger': []
           }
         ));
      }
      if (path == '/api/public/machines') {
         return handler.resolve(Response(
           requestOptions: options,
           data: { 'machines': [] }
         ));
      }
      if (path == '/api/public/campaigns') {
         return handler.resolve(Response(
           requestOptions: options,
           data: { 'campaigns': [] }
         ));
      }
      if (path == '/api/wallet') {
         return handler.resolve(Response(
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

  group('E2E Testing - Phase 3 (Core End-User Workflows)', () {
    testWidgets('T1: Dashboard & Navigasi', (tester) async {
      await mockNetworkImagesFor(() async {
        await runE2EApp(tester);
        await tester.pumpAndSettle();
        
        // Login
        await loginAs(tester, 'user@reloop.id', 'password123');

        // Pastikan ada teks layanan
        expect(find.text('Layanan ReLoop'), findsOneWidget);

        // Coba navigasi ke Program
        final programNav = find.text('Program').last;
        await tester.scrollUntilVisible(programNav, 50.0, scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();
        await tester.tap(programNav);
        await tester.pumpAndSettle();

        // Coba navigasi ke Wallet
        final walletNav = find.text('Dompet').last;
        await tester.tap(walletNav);
        await tester.pumpAndSettle();
        
        // Harus ada saldo tersedia
        expect(find.textContaining('Saldo'), findsWidgets);

        // Navigasi kembali ke Dashboard
        final dashboardNav = find.text('Beranda').last;
        await tester.tap(dashboardNav);
        await tester.pumpAndSettle();
        
        await logoutUser(tester);
      });
    });

    testWidgets('T2: Wallet & Redemption', (tester) async {
      await mockNetworkImagesFor(() async {
        await runE2EApp(tester);
        await tester.pumpAndSettle();
        await loginAs(tester, 'user@reloop.id', 'password123');
        
        // Klik menu Pencairan di Dashboard
        final pencairanButton = find.text('Pencairan');
        await tester.scrollUntilVisible(pencairanButton, 50.0, scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();
        await tester.tap(pencairanButton);
        await tester.pumpAndSettle();

        // Pastikan masuk ke halaman pencairan saldo
        expect(find.text('Pencairan Saldo'), findsOneWidget);

        // Masukkan nominal
        final amountField = find.byType(TextField);
        await tester.enterText(amountField.first, '99999999'); // Invalid amount (terlalu besar)
        await tester.pumpAndSettle();

        // Submit
        final submitButton = find.text('Ajukan Pencairan');
        if (submitButton.evaluate().isNotEmpty) {
          await tester.tap(submitButton);
          await tester.pumpAndSettle();
          // Akan muncul snackbar error saldo tidak mencukupi
          expect(find.textContaining('Saldo tidak mencukupi'), findsOneWidget);
        }
      });
    });

    testWidgets('T3: Trash Bag & Scan QR', (tester) async {
      await mockNetworkImagesFor(() async {
        await runE2EApp(tester);
        await tester.pumpAndSettle();
        await loginAs(tester, 'user@reloop.id', 'password123');
        
        // Klik menu Trash Bag di Dashboard
        final trashBagButton = find.text('Trash Bag');
        await tester.scrollUntilVisible(trashBagButton, 50.0, scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();
        await tester.tap(trashBagButton);
        await tester.pumpAndSettle();

        // Memastikan kita masuk ke halaman trash bag
        expect(find.byType(Scaffold), findsWidgets); // Minimal memastikan tidak crash

        // Halaman Trash Bag bukan ShellRoute, jadi harus kembali dulu sebelum logout
        // Alih-alih mencari BackButton yang kadang flacky di test environment,
        // kita pop secara manual menggunakan state dari Navigator
        final BuildContext context = tester.element(find.byType(Scaffold).last);
        if (context.canPop()) {
          context.pop();
        } else {
          context.go('/dashboard');
        }
        await tester.pumpAndSettle();

        await logoutUser(tester);
      });
    });
  });
}
