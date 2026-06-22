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

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Hive.initFlutter();

  try {
    await Firebase.initializeApp();
  } catch (_) {}

  await Environment.load(BuildEnvironment.development);

  final offline = OfflineService();
  await offline.init();

  final analytics = AnalyticsService();
  analytics.initialize();

  final crashlytics = CrashlyticsService();
  crashlytics.initialize();

  final connectivity = ConnectivityProvider();

  final apiClient = ApiClient(baseUrl: Environment.apiBaseUrl);
  final authProvider = AuthProvider(apiClient);
  final themeProvider = ThemeProvider();
  final notifService = NotificationService();
  notifService.setApiClient(apiClient);

  final syncService = BackgroundSyncService();

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
