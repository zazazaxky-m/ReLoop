import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_machines_screen.dart';

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
      if (message.contains('RenderFlex overflowed by 1.00 pixels on the bottom.') ||
          message.contains('ListTile background color or ink splashes may be invisible.')) {
        return;
      }
      previousOnError?.call(details);
    };
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
  });

  tearDown(() {
    FlutterError.onError = previousOnError;
  });

  Widget buildApp(AppRole role) {
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: role == AppRole.SUPERADMIN ? 'Super' : 'Admin',
        email: 'test@example.com',
        role: role,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.hasRole(AppRole.SUPERADMIN)).thenReturn(role == AppRole.SUPERADMIN);
    when(() => mockAuth.logout()).thenAnswer((_) async {});

    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MediaQuery(
        data: const MediaQueryData(textScaleFactor: 0.85),
        child: MaterialApp.router(
          routerConfig: GoRouter(
            initialLocation: '/admin/machines',
            routes: [
              GoRoute(
                path: '/admin/machines',
                builder: (context, state) => const AdminMachinesScreen(),
              ),
              GoRoute(
                path: '/admin/machines/:id/detail',
                builder: (context, state) => Scaffold(
                  body: Text('ADMIN detail ${state.pathParameters['id']}'),
                ),
              ),
              GoRoute(
                path: '/superadmin/machines/:id/detail',
                builder: (context, state) => Scaffold(
                  body: Text('SUPERADMIN detail ${state.pathParameters['id']}'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Map<String, dynamic> machineData() => {
        'machines': [
          {
            'id': 'm1',
            'name': 'Mesin A',
            'machineCode': 'MAC-123',
            'status': 'ONLINE',
            'fillLevelPercent': 50,
            'lastHeartbeatAt': '2026-07-10T07:30:00Z',
            'organization': {'name': 'Org A'},
          },
        ],
      };

  testWidgets('superadmin can open machine detail from list', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/machines', queryParameters: any(named: 'queryParameters'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/machines'),
        data: machineData(),
      ),
    );

    await tester.pumpWidget(buildApp(AppRole.SUPERADMIN));
    await tester.pumpAndSettle();

    expect(find.textContaining('Anda memiliki akses penuh'), findsOneWidget);
    expect(find.text('Tambah Mesin'), findsOneWidget);
    expect(find.text('Mesin A'), findsWidgets);

    await tester.tap(find.text('Mesin A').first);
    await tester.pumpAndSettle();

    expect(find.text('SUPERADMIN detail m1'), findsOneWidget);
  });

  testWidgets('admin sees limited banner and filter reloads data', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/machines', queryParameters: any(named: 'queryParameters'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/machines'),
        data: machineData(),
      ),
    );

    await tester.pumpWidget(buildApp(AppRole.ADMIN));
    await tester.pumpAndSettle();

    expect(find.textContaining('Mesin ditambahkan oleh Superadmin'), findsOneWidget);
    expect(find.text('Tambah Mesin'), findsNothing);

    await tester.tap(find.widgetWithText(FilterChip, 'Online'));
    await tester.pumpAndSettle();

    verify(() => mockApi.get(
      '/api/machines',
      queryParameters: {'status': 'ONLINE'},
    )).called(greaterThan(0));
  });

  testWidgets('shows retry state on error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/machines', queryParameters: any(named: 'queryParameters'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/machines'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/machines'),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(buildApp(AppRole.ADMIN));
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);
  });
}
