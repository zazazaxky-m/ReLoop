import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:firebase_core/firebase_core.dart';
import 'core/api_client.dart';
import 'core/auth_provider.dart';
import 'core/router.dart';
import 'config/environment.dart';
import 'providers/theme_provider.dart';
import 'services/notification_service.dart';
import 'services/analytics_service.dart';
import 'services/crashlytics_service.dart';
import 'theme/app_theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    await Firebase.initializeApp();
  } catch (_) {}

  await Environment.load(BuildEnvironment.development);

  final analytics = AnalyticsService();
  analytics.initialize();

  final crashlytics = CrashlyticsService();
  crashlytics.initialize();

  final apiClient = ApiClient(baseUrl: Environment.apiBaseUrl);
  final authProvider = AuthProvider(apiClient);
  final themeProvider = ThemeProvider();
  final notifService = NotificationService();
  notifService.setApiClient(apiClient);

  runApp(
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: apiClient),
        ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
        ChangeNotifierProvider<ThemeProvider>.value(value: themeProvider),
      ],
      child: ReloopApp(
        authProvider: authProvider,
        notifService: notifService,
        analytics: analytics,
        crashlytics: crashlytics,
      ),
    ),
  );
}

class ReloopApp extends StatelessWidget {
  final AuthProvider authProvider;
  final NotificationService notifService;
  final AnalyticsService analytics;
  final CrashlyticsService crashlytics;

  const ReloopApp({
    super.key,
    required this.authProvider,
    required this.notifService,
    required this.analytics,
    required this.crashlytics,
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
