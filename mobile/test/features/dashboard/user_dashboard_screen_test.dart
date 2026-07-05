import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/features/dashboard/user_dashboard_screen.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/theme/app_theme.dart';
import 'package:provider/provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';

class MockAuthProvider extends Mock implements AuthProvider {}
class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockAuthProvider mockAuth;
  late MockApiClient mockApi;

  setUp(() {
    mockAuth = MockAuthProvider();
    mockApi = MockApiClient();
    
    when(() => mockAuth.user).thenReturn(
      CurrentUser(id: '1', name: 'John', email: 'john@a.com', role: AppRole.USER, status: 'ACTIVE')
    );
  });

  Widget buildScreen() {
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (context, state) => const UserDashboardScreen()),
        GoRoute(path: '/wallet', builder: (context, state) => const Scaffold()),
      ],
    );

    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MaterialApp.router(
        theme: AppTheme.light,
        routerConfig: router,
      ),
    );
  }

  testWidgets('UserDashboardScreen loads and renders data', (WidgetTester tester) async {
    when(() => mockApi.get('/api/user/dashboard')).thenAnswer((_) async => Response(
      requestOptions: RequestOptions(path: ''),
      data: {
        'balance': {'available': 15000, 'pending': 0},
        'pointsToRupiah': 5,
        'isTravelAgent': false,
        'recentSessions': [],
        'recentLedger': [],
        'campaigns': []
      }
    ));

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.textContaining('Halo, John'), findsOneWidget);
    expect(find.textContaining('15.000'), findsOneWidget); // Balance
    expect(find.text('Layanan ReLoop'), findsOneWidget);
  });
}
