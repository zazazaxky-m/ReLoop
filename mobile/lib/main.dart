import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'core/api_client.dart';
import 'core/auth_provider.dart';
import 'core/router.dart';
import 'config/environment.dart';
import 'providers/theme_provider.dart';
import 'providers/connectivity_provider.dart';
import 'services/notification_service.dart';
import 'services/analytics_service.dart';
import 'services/crashlytics_service.dart';
import 'services/offline_service.dart';
import 'services/background_sync_service.dart';
import 'theme/app_theme.dart';

Future<void> main({ApiClient? injectedApiClient}) async {
  WidgetsFlutterBinding.ensureInitialized();

  await Hive.initFlutter();

  try {
    await Firebase.initializeApp();
  } catch (_) {}

  // Defaults to development so a plain `flutter run` (or forgetting the
  // --dart-define below) never silently talks to the production API.
  // Release builds MUST pass --dart-define=BUILD_ENV=production explicitly
  // (see mobile/README.md).
  const envStr = String.fromEnvironment('BUILD_ENV', defaultValue: 'development');
  final env = BuildEnvironment.values.firstWhere(
    (e) => e.name == envStr,
    orElse: () => BuildEnvironment.production,
  );
  await Environment.load(env);

  final offline = OfflineService();
  await offline.init();

  final analytics = AnalyticsService();
  analytics.initialize();

  final crashlytics = CrashlyticsService();
  crashlytics.initialize();

  final connectivity = ConnectivityProvider();

  final apiClient = injectedApiClient ?? ApiClient(baseUrl: Environment.apiBaseUrl);
  final authProvider = AuthProvider(apiClient);
  final themeProvider = ThemeProvider();
  final notifService = NotificationService();
  notifService.setApiClient(apiClient);
  // Safe no-op without Firebase config (see mobile/README.md "Setup
  // Firebase"); only sets up local channels/permissions/token, actual
  // server registration happens post-login in AuthProvider.
  await notifService.initialize();

  final syncService = BackgroundSyncService();
  // Ticks every 15 min regardless of auth state; unauthenticated ticks just
  // 401 cheaply against the shared ApiClient/cookie jar and are swallowed
  // internally, so this is safe to start before login completes.
  syncService.start(apiClient);

  runApp(
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: apiClient),
        ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
        ChangeNotifierProvider<ThemeProvider>.value(value: themeProvider),
        ChangeNotifierProvider<ConnectivityProvider>.value(value: connectivity),
      ],
      child: ReloopApp(
        authProvider: authProvider,
        notifService: notifService,
        analytics: analytics,
        crashlytics: crashlytics,
        syncService: syncService,
      ),
    ),
  );
}

class ReloopApp extends StatelessWidget {
  final AuthProvider authProvider;
  final NotificationService notifService;
  final AnalyticsService analytics;
  final CrashlyticsService crashlytics;
  final BackgroundSyncService syncService;

  const ReloopApp({
    super.key,
    required this.authProvider,
    required this.notifService,
    required this.analytics,
    required this.crashlytics,
    required this.syncService,
  });

  @override
  Widget build(BuildContext context) {
    final router = AppRouter(
      authProvider,
      notifService,
      analytics: analytics,
    ).router;
    final themeMode = context.watch<ThemeProvider>().themeMode;

    return MaterialApp.router(
      title: 'ReLoop',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: themeMode,
      routerConfig: router,
    );
  }
}
