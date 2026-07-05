import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/router.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/services/notification_service.dart';
import 'package:reloop_mobile/services/analytics_service.dart';
import 'package:mocktail/mocktail.dart';

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

  setUp(() {
    mockAuth = MockAuthProvider();
    mockNotif = MockNotificationService();
    mockAnalytics = MockAnalyticsService();
    when(() => mockAuth.isAuthenticated).thenReturn(false);
  });

  test('AppRouter initializes correctly', () {
    final appRouter = AppRouter(mockAuth, mockNotif, analytics: mockAnalytics);
    expect(appRouter.router, isNotNull);
  });
}
