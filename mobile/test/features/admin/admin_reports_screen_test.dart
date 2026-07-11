import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_reports_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockApiClient mockApi;
  late MockAuthProvider mockAuth;

  setUp(() {
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'Admin',
        email: 'admin@example.com',
        role: AppRole.ADMIN,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.hasRole(AppRole.SUPERADMIN)).thenReturn(false);
    when(() => mockAuth.logout()).thenAnswer((_) async {});
  });

  void suppressHarmlessErrors() {
    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      final message = details.exceptionAsString();
      if (message.contains('RenderFlex overflowed') ||
          message.contains('ListTile background')) {
        return;
      }
      previous?.call(details);
    };
  }

  Widget buildApp() {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(0.85)),
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: GoRouter(
            initialLocation: '/admin/reports',
            routes: [
              GoRoute(
                path: '/admin/reports',
                builder: (context, state) => const AdminReportsScreen(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Response ok(String path, dynamic data) => Response(
        requestOptions: RequestOptions(path: path),
        data: data,
      );

  DioException serverError(String path) => DioException(
        requestOptions: RequestOptions(path: path),
        response: Response(
          requestOptions: RequestOptions(path: path),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      );

  void stubSummary() {
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer(
      (_) async => ok('/api/mobile/overview', {
        'depositCount': 42,
        'pickups': [
          {'id': 'p1'},
          {'id': 'p2'},
        ],
      }),
    );
    when(() => mockApi.get('/api/reports', queryParameters: {'type': 'rewards'}))
        .thenAnswer(
      (_) async => ok(
        '/api/reports',
        'id,user,type,amount\n'
        '1,u1,EARN,1500\n'
        '2,u2,EARN,2500\n'
        '3,u3,REDEEM,1000\n',
      ),
    );
  }

  testWidgets('loads report summary metrics', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubSummary();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Laporan'), findsOneWidget);
    expect(find.text('Item Diterima'), findsOneWidget);
    expect(find.text('Pickup Selesai'), findsOneWidget);
    expect(find.text('Reward Diterbitkan'), findsOneWidget);
    expect(find.textContaining('Rp 4.000'), findsOneWidget);
    expect(find.text('Unduh Laporan CSV'), findsOneWidget);
    expect(find.text('Laporan Deposit'), findsOneWidget);
    expect(find.text('Laporan Reward'), findsOneWidget);
    expect(find.text('Laporan Pickup'), findsOneWidget);
    expect(find.textContaining('Data dibatasi 5000 baris'), findsOneWidget);
  });

  testWidgets('shows retry on error and recovers', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    var calls = 0;
    when(() => mockApi.get('/api/mobile/overview')).thenAnswer((_) async {
      calls++;
      if (calls == 1) throw serverError('/api/mobile/overview');
      return ok('/api/mobile/overview', {
        'depositCount': 1,
        'pickups': [],
      });
    });
    when(() => mockApi.get('/api/reports', queryParameters: {'type': 'rewards'}))
        .thenAnswer((_) async => ok('/api/reports', 'id,user,type,amount\n'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);

    await tester.tap(find.text('Coba Lagi'));
    await tester.pumpAndSettle();

    expect(find.text('Unduh Laporan CSV'), findsOneWidget);
  });

  testWidgets('download failure shows snackbar', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubSummary();
    when(() => mockApi.get('/api/reports', queryParameters: {'type': 'deposits'}))
        .thenThrow(serverError('/api/reports'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Laporan Deposit'));
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });
}
