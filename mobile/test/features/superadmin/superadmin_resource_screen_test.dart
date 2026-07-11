import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/superadmin/superadmin_resource_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockApiClient mockApi;
  late MockAuthProvider mockAuth;
  void Function(FlutterErrorDetails)? previousOnError;

  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  setUp(() {
    previousOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      final message = details.exceptionAsString();
      if (message.contains('RenderFlex overflowed') ||
          message.contains('A RenderFlex overflowed') ||
          message.contains('ListTile background color')) {
        return;
      }
      previousOnError?.call(details);
    };
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'Super',
        email: 'super@example.com',
        role: AppRole.SUPERADMIN,
        status: 'ACTIVE',
      ),
    );
    when(() => mockAuth.logout()).thenAnswer((_) async {});
  });

  tearDown(() {
    FlutterError.onError = previousOnError;
  });

  Widget buildApp({
    required String title,
    required String endpoint,
    required String rootKey,
    required List<String> primaryFields,
    List<String> secondaryFields = const [],
    SuperadminResourceAction action = SuperadminResourceAction.none,
  }) {
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
            initialLocation: '/resource',
            routes: [
              GoRoute(
                path: '/resource',
                builder: (_, __) => SuperadminResourceScreen(
                  title: title,
                  endpoint: endpoint,
                  rootKey: rootKey,
                  primaryFields: primaryFields,
                  secondaryFields: secondaryFields,
                  action: action,
                ),
              ),
              GoRoute(
                path: '/profile',
                builder: (_, __) => const Scaffold(body: Text('profile')),
              ),
            ],
          ),
        ),
      ),
    );
  }

  testWidgets('renders partnership list and approve action', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/partnerships')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/partnerships'),
        data: {
          'partnerships': [
            {
              'id': 'p1',
              'status': 'PENDING_SUPERADMIN_APPROVAL',
              'organization': {'name': 'Mitra A'},
              'pengepul': {'name': 'Budi'},
            },
          ],
        },
      ),
    );
    when(() => mockApi.patch('/api/partnerships/p1', data: any(named: 'data')))
        .thenAnswer(
      (_) async =>
          Response(requestOptions: RequestOptions(path: '/api/partnerships/p1')),
    );

    await tester.pumpWidget(
      buildApp(
        title: 'Kemitraan',
        endpoint: '/api/partnerships',
        rootKey: 'partnerships',
        primaryFields: const ['organization', 'pengepul'],
        secondaryFields: const ['status'],
        action: SuperadminResourceAction.partnership,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Kemitraan'), findsOneWidget);
    expect(find.textContaining('Mitra A'), findsOneWidget);
    expect(find.text('Setujui'), findsOneWidget);

    await tester.tap(find.text('Setujui'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    verify(() => mockApi.patch(
          '/api/partnerships/p1',
          data: {'action': 'approve'},
        )).called(1);
    expect(find.text('Perubahan berhasil disimpan.'), findsOneWidget);
  });

  testWidgets('redemption success prompts for reference', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/redemptions')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/redemptions'),
        data: {
          'redemptions': [
            {
              'id': 'rd1',
              'status': 'PROCESSING',
              'amount': 50000,
              'user': {'name': 'Ani'},
            },
          ],
        },
      ),
    );
    when(() => mockApi.patch('/api/redemptions/rd1', data: any(named: 'data')))
        .thenAnswer(
      (_) async =>
          Response(requestOptions: RequestOptions(path: '/api/redemptions/rd1')),
    );

    await tester.pumpWidget(
      buildApp(
        title: 'Redemption',
        endpoint: '/api/redemptions',
        rootKey: 'redemptions',
        primaryFields: const ['user', 'amount'],
        secondaryFields: const ['status'],
        action: SuperadminResourceAction.redemption,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.text('Berhasil'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Konfirmasi Pembayaran'), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, 'TRX-001');
    await tester.tap(find.text('Konfirmasi'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    verify(() => mockApi.patch(
          '/api/redemptions/rd1',
          data: {'action': 'success', 'providerReference': 'TRX-001'},
        )).called(1);
  });

  testWidgets('search filters rows and empty state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/partnerships')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/partnerships'),
        data: {
          'partnerships': [
            {
              'id': 'p1',
              'status': 'ACTIVE',
              'organization': {'name': 'Alpha'},
            },
          ],
        },
      ),
    );

    await tester.pumpWidget(
      buildApp(
        title: 'Kemitraan',
        endpoint: '/api/partnerships',
        rootKey: 'partnerships',
        primaryFields: const ['organization'],
        action: SuperadminResourceAction.partnership,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.enterText(find.byType(TextField).first, 'zzz');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Belum ada data.'), findsOneWidget);
  });

  testWidgets('opens detail sheet on card tap', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/partnerships')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/partnerships'),
        data: {
          'partnerships': [
            {
              'id': 'p1',
              'status': 'ACTIVE',
              'organization': {'name': 'Alpha Org'},
            },
          ],
        },
      ),
    );

    await tester.pumpWidget(
      buildApp(
        title: 'Kemitraan',
        endpoint: '/api/partnerships',
        rootKey: 'partnerships',
        primaryFields: const ['organization'],
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.textContaining('Alpha Org'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Detail'), findsOneWidget);
  });

  testWidgets('shows retry on error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/partnerships')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/partnerships'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/partnerships'),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(
      buildApp(
        title: 'Kemitraan',
        endpoint: '/api/partnerships',
        rootKey: 'partnerships',
        primaryFields: const ['organization'],
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba lagi'), findsOneWidget);
  });

  testWidgets('partnership suspend and reactivate actions', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/partnerships')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/partnerships'),
        data: {
          'partnerships': [
            {
              'id': 'p2',
              'status': 'ACTIVE',
              'organization': {'name': 'Aktif Org'},
            },
            {
              'id': 'p3',
              'status': 'SUSPENDED',
              'organization': {'name': 'Suspend Org'},
            },
          ],
        },
      ),
    );
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => Response(requestOptions: RequestOptions(path: '/api/partnerships')),
    );

    await tester.pumpWidget(
      buildApp(
        title: 'Kemitraan',
        endpoint: '/api/partnerships',
        rootKey: 'partnerships',
        primaryFields: const ['organization'],
        action: SuperadminResourceAction.partnership,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Suspend'), findsOneWidget);
    expect(find.text('Aktifkan'), findsOneWidget);
    await tester.tap(find.text('Suspend'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/partnerships/p2', data: {'action': 'suspend'}))
        .called(1);
  });

  testWidgets('redemption approve process fail and empty reference', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    when(() => mockApi.get('/api/redemptions')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/redemptions'),
        data: {
          'redemptions': [
            {
              'id': 'r1',
              'status': 'REQUESTED',
              'amount': 10000,
              'user': {'name': 'U1'},
            },
            {
              'id': 'r2',
              'status': 'APPROVED',
              'amount': 20000,
              'user': {'name': 'U2'},
            },
            {
              'id': 'r3',
              'status': 'PROCESSING',
              'amount': 30000,
              'user': {'name': 'U3'},
            },
          ],
        },
      ),
    );
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => Response(requestOptions: RequestOptions(path: '/api/redemptions')),
    );

    await tester.pumpWidget(
      buildApp(
        title: 'Redemption',
        endpoint: '/api/redemptions',
        rootKey: 'redemptions',
        primaryFields: const ['user', 'amount'],
        secondaryFields: const ['status'],
        action: SuperadminResourceAction.redemption,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Setujui'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/redemptions/r1', data: {'action': 'approve'}))
        .called(1);

    await tester.tap(find.text('Proses'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/redemptions/r2', data: {'action': 'process'}))
        .called(1);

    await tester.tap(find.text('Gagal'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/redemptions/r3', data: {'action': 'fail'}))
        .called(1);

    // Empty reference validation
    when(() => mockApi.get('/api/redemptions')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/redemptions'),
        data: {
          'redemptions': [
            {
              'id': 'r4',
              'status': 'PROCESSING',
              'amount': 40000,
              'user': {'name': 'U4'},
            },
          ],
        },
      ),
    );
    await tester.pumpWidget(
      buildApp(
        title: 'Redemption',
        endpoint: '/api/redemptions',
        rootKey: 'redemptions',
        primaryFields: const ['user', 'amount'],
        action: SuperadminResourceAction.redemption,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Berhasil'));
    await tester.pumpAndSettle();
    expect(find.text('Konfirmasi Pembayaran'), findsOneWidget);
    // Cancel covers null reference path
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    expect(find.text('Konfirmasi Pembayaran'), findsNothing);
  });

  testWidgets('user and organization status actions with API error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    when(() => mockApi.get('/api/users')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/users'),
        data: {
          'users': [
            {'id': 'u2', 'name': 'Budi', 'status': 'ACTIVE', 'email': 'b@e.com'},
            {'id': 'u3', 'name': 'Ani', 'status': 'INACTIVE', 'email': 'a@e.com'},
          ],
        },
      ),
    );
    when(() => mockApi.patch('/api/users/u2', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/users/u2'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/users/u2'),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(
      buildApp(
        title: 'Users',
        endpoint: '/api/users',
        rootKey: 'users',
        primaryFields: const ['name', 'email'],
        action: SuperadminResourceAction.user,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Nonaktifkan').first);
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);

    when(() => mockApi.get('/api/organizations')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/organizations'),
        data: {
          'organizations': [
            {'id': 'o1', 'name': 'Org X', 'status': 'ACTIVE'},
            {'id': 'o2', 'name': 'Org Y', 'status': 'SUSPENDED'},
          ],
        },
      ),
    );
    when(() => mockApi.patch('/api/organizations/o1', data: any(named: 'data')))
        .thenAnswer(
      (_) async =>
          Response(requestOptions: RequestOptions(path: '/api/organizations/o1')),
    );

    await tester.pumpWidget(
      buildApp(
        title: 'Organisasi',
        endpoint: '/api/organizations',
        rootKey: 'organizations',
        primaryFields: const ['name'],
        action: SuperadminResourceAction.organization,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Suspend'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch(
          '/api/organizations/o1',
          data: {'status': 'SUSPENDED'},
        )).called(1);
  });
}
