import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_compliance_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockApiClient mockApi;
  late MockAuthProvider mockAuth;
  void Function(FlutterErrorDetails)? previousOnError;

  setUp(() {
    previousOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      final message = details.exceptionAsString();
      if (message.contains('RenderFlex overflowed') ||
          message.contains('A RenderFlex overflowed') ||
          message.contains('ListTile background color or ink splashes may be invisible.')) {
        return;
      }
      previousOnError?.call(details);
    };
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

  tearDown(() {
    FlutterError.onError = previousOnError;
  });

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
            initialLocation: '/admin/compliance',
            routes: [
              GoRoute(
                path: '/admin/compliance',
                builder: (context, state) => const AdminComplianceScreen(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Response ok(String path, Map<String, dynamic> data) => Response(
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

  void stubLoad({
    List<Map<String, dynamic>>? trips,
    List<Map<String, dynamic>>? agents,
  }) {
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => ok('/api/trips', {
        'trips': trips ??
            [
              {'id': 't1', 'complianceStatus': 'COMPLIANT'},
              {'id': 't2', 'complianceStatus': 'NEEDS_REVIEW'},
              {'id': 't3', 'complianceStatus': 'NON_COMPLIANT'},
            ],
      }),
    );
    when(() => mockApi.get('/api/travel-agents')).thenAnswer(
      (_) async => ok('/api/travel-agents', {
        'agents': agents ??
            [
              {
                'name': 'Agent Patuh',
                'email': 'ok@example.com',
                'tripCount': 5,
                'compliantCount': 5,
                'nonCompliantCount': 0,
                'reviewCount': 0,
              },
              {
                'name': 'Agent Review',
                'email': 'rev@example.com',
                'tripCount': 4,
                'compliantCount': 2,
                'nonCompliantCount': 0,
                'reviewCount': 2,
              },
              {
                'name': 'Agent Tidak Patuh',
                'email': 'bad@example.com',
                'tripCount': 3,
                'compliantCount': 1,
                'nonCompliantCount': 2,
                'reviewCount': 0,
              },
            ],
      }),
    );
  }

  testWidgets('loads compliance metrics and agent rows', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Compliance Wisata'), findsOneWidget);
    expect(find.text('Total Trip'), findsOneWidget);
    expect(find.text('Trip Patuh'), findsOneWidget);
    expect(find.text('Perlu Review'), findsOneWidget);
    expect(find.text('Tidak Patuh'), findsOneWidget);
    expect(find.text('Agent Patuh'), findsOneWidget);
    expect(find.text('Agent Review'), findsOneWidget);
    expect(find.text('Agent Tidak Patuh'), findsOneWidget);
    expect(find.textContaining('2 review'), findsOneWidget);
    expect(find.textContaining('tidak patuh'), findsWidgets);
  });

  testWidgets('empty agents shows empty copy', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad(trips: [], agents: []);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada data compliance.'), findsOneWidget);
  });

  testWidgets('shows retry on error and recovers', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    var calls = 0;
    when(() => mockApi.get('/api/trips')).thenAnswer((_) async {
      calls++;
      if (calls == 1) throw serverError('/api/trips');
      return ok('/api/trips', {
        'trips': [
          {'id': 't1', 'complianceStatus': 'COMPLIANT'},
        ],
      });
    });
    when(() => mockApi.get('/api/travel-agents')).thenAnswer(
      (_) async => ok('/api/travel-agents', {
        'agents': [
          {
            'name': 'Agent Recovered',
            'email': 'r@example.com',
            'tripCount': 1,
            'compliantCount': 1,
            'nonCompliantCount': 0,
            'reviewCount': 0,
          },
        ],
      }),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    await tester.tap(find.text('Coba Lagi'));
    await tester.pumpAndSettle();

    expect(find.text('Agent Recovered'), findsOneWidget);
  });

  testWidgets('null trips/agents keys fall back to empty lists', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => ok('/api/trips', {'trips': null}),
    );
    when(() => mockApi.get('/api/travel-agents')).thenAnswer(
      (_) async => ok('/api/travel-agents', {'agents': null}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada data compliance.'), findsOneWidget);
  });
}
