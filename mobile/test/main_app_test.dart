import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/main.dart';
import 'package:reloop_mobile/providers/theme_provider.dart';
import 'package:reloop_mobile/services/analytics_service.dart';
import 'package:reloop_mobile/services/background_sync_service.dart';
import 'package:reloop_mobile/services/crashlytics_service.dart';
import 'package:reloop_mobile/services/notification_service.dart';

class MockAuthProvider extends Mock implements AuthProvider {}

class MockNotificationService extends Mock implements NotificationService {
  @override
  void Function(String route, Map<String, String>? params)? onNotificationTap;
}

class MockAnalyticsService extends Mock implements AnalyticsService {}

class MockCrashlyticsService extends Mock implements CrashlyticsService {}

class MockBackgroundSyncService extends Mock implements BackgroundSyncService {}

void main() {
  testWidgets('ReloopApp builds MaterialApp.router', (tester) async {
    final auth = MockAuthProvider();
    final notif = MockNotificationService();
    final analytics = MockAnalyticsService();
    final crashlytics = MockCrashlyticsService();
    final sync = MockBackgroundSyncService();

    when(() => auth.isAuthenticated).thenReturn(false);
    when(() => auth.user).thenReturn(null);
    when(() => auth.dashboardRoute).thenReturn('/login');
    when(() => auth.checkSession()).thenAnswer((_) async => null);
    when(() => analytics.logScreenView(screenName: any(named: 'screenName')))
        .thenAnswer((_) async {});

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider(create: (_) => ThemeProvider()),
        ],
        child: ReloopApp(
          authProvider: auth,
          notifService: notif,
          analytics: analytics,
          crashlytics: crashlytics,
          syncService: sync,
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
