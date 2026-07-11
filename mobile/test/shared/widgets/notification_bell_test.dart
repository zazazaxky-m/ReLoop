import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/shared/widgets/notification_bell.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
  });

  Widget buildApp() {
    return MultiProvider(
      providers: [Provider<ApiClient>.value(value: mockApi)],
      child: MaterialApp.router(
        theme: AppTheme.light,
        routerConfig: GoRouter(
          initialLocation: '/',
          routes: [
            GoRoute(
              path: '/',
              builder: (_, __) => const Scaffold(
                appBar: null,
                body: Center(child: NotificationBell()),
              ),
            ),
            GoRoute(
              path: '/notifications',
              builder: (_, __) => const Scaffold(body: Text('notif page')),
            ),
          ],
        ),
      ),
    );
  }

  testWidgets('shows badge when unreadCount > 0', (tester) async {
    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'unreadCount': 3},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('3'), findsOneWidget);
    expect(find.byIcon(Icons.notifications_none_rounded), findsOneWidget);
  });

  testWidgets('shows 9+ for unread above 9', (tester) async {
    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'unreadCount': 12},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('9+'), findsOneWidget);
  });

  testWidgets('hides badge when count is zero or request fails', (tester) async {
    when(() => mockApi.get('/api/notifications')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/notifications'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('9+'), findsNothing);
    expect(find.text('0'), findsNothing);
  });

  testWidgets('tap navigates to notifications and reloads', (tester) async {
    when(() => mockApi.get('/api/notifications')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/notifications'),
        data: {'unreadCount': 2},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.byType(NotificationBell));
    await tester.pumpAndSettle();

    expect(find.text('notif page'), findsOneWidget);
    // Pop back so NotificationBell._open reloads unread count.
    final navigator = tester.state<NavigatorState>(find.byType(Navigator).first);
    navigator.pop();
    await tester.pumpAndSettle();

    verify(() => mockApi.get('/api/notifications')).called(greaterThan(1));
  });
}
