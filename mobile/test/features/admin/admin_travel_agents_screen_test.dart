import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_travel_agents_screen.dart';
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
            initialLocation: '/admin/travel-agents',
            routes: [
              GoRoute(
                path: '/admin/travel-agents',
                builder: (context, state) => const AdminTravelAgentsScreen(),
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

  List<Map<String, dynamic>> agentsData() => [
        {
          'id': 'a1',
          'name': 'Travel Nusantara',
          'email': 'ta@example.com',
          'contactPerson': 'Sari',
          'phone': '081234',
          'organizationStatus': 'INVITED',
          'tripCount': 10,
          'compliantCount': 8,
          'nonCompliantCount': 1,
        },
        {
          'id': 'a2',
          'name': 'Travel Suspended',
          'email': 'sus@example.com',
          'organizationStatus': 'SUSPENDED',
          'tripCount': 2,
          'compliantCount': 0,
          'nonCompliantCount': 2,
        },
      ];

  void stubAgents([List<Map<String, dynamic>>? agents]) {
    when(() => mockApi.get('/api/travel-agents')).thenAnswer(
      (_) async => ok('/api/travel-agents', {'agents': agents ?? agentsData()}),
    );
  }

  testWidgets('loads agents with metrics', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubAgents();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Travel Agent'), findsOneWidget);
    expect(find.text('Total Agent'), findsOneWidget);
    expect(find.text('Invited'), findsOneWidget);
    expect(find.text('Trip Patuh'), findsOneWidget);
    expect(find.text('Tidak Patuh'), findsOneWidget);
    expect(find.text('Travel Nusantara'), findsOneWidget);
    expect(find.text('Tambah Travel Agent'), findsOneWidget);
    expect(find.text('Suspend'), findsOneWidget);
    expect(find.text('Aktifkan'), findsOneWidget);
  });

  testWidgets('empty state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubAgents([]);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada travel agent.'), findsOneWidget);
  });

  testWidgets('shows retry on error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/travel-agents'))
        .thenThrow(serverError('/api/travel-agents'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);
  });

  // POST /api/travel-agents (A03) mails an invitation and answers with the
  // agent's status here: PENDING until it is accepted, INVITED when the agent
  // was already active.
  Future<void> invite(WidgetTester tester, String organizationStatus) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubAgents();
    when(() => mockApi.post('/api/travel-agents', data: any(named: 'data')))
        .thenAnswer(
      (_) async => ok('/api/travel-agents', {
        'invite': {'id': 'inv-1'},
        'organizationStatus': organizationStatus,
        'delivery': 'QUEUED',
      }),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tambah Travel Agent'));
    await tester.pumpAndSettle();
    expect(find.text('Tambah Travel Agent'), findsWidgets);

    await tester.enterText(find.widgetWithText(TextField, 'Nama'), 'Agent Baru');
    await tester.enterText(
      find.widgetWithText(TextField, 'Email'),
      'baru@example.com',
    );
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();
  }

  testWidgets('invite dialog posts and shows the invitation is pending',
      (tester) async {
    await invite(tester, 'PENDING');
    expect(
      find.textContaining('Status pending sampai undangan diterima'),
      findsOneWidget,
    );
  });

  testWidgets('re-inviting an active agent keeps verified members',
      (tester) async {
    await invite(tester, 'INVITED');
    expect(
      find.textContaining('Anggota yang sudah terverifikasi tetap punya akses'),
      findsOneWidget,
    );
  });

  testWidgets('suspend action shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubAgents();
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => ok('/api/travel-agents/a1', {}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Suspend'));
    await tester.pumpAndSettle();
    expect(find.text('Travel agent ditangguhkan'), findsOneWidget);
  });

  testWidgets('remove action shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubAgents();
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => ok('/api/travel-agents/a1', {}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Hapus').first);
    await tester.pumpAndSettle();
    expect(
      find.text('Travel agent dihapus dari organisasi'),
      findsOneWidget,
    );
  });

  testWidgets('invite dialog sends contact person/phone/notes fields',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubAgents();
    when(() => mockApi.post('/api/travel-agents', data: any(named: 'data')))
        .thenAnswer(
      (_) async => ok('/api/travel-agents', {
        'invite': {'status': 'INVITED'},
      }),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tambah Travel Agent'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Nama'), 'Agent C');
    await tester.enterText(
      find.widgetWithText(TextField, 'Email'),
      'c@example.com',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Kontak Person'),
      'Citra',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Nomor HP'),
      '08123',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Catatan'),
      'VIP',
    );
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    final captured = verify(
      () => mockApi.post('/api/travel-agents', data: captureAny(named: 'data')),
    ).captured.single as Map<String, dynamic>;
    expect(captured['contactPerson'], 'Citra');
    expect(captured['phone'], '08123');
    expect(captured['notes'], 'VIP');
  });

  testWidgets('invite dialog shows error snackbar on failure', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubAgents();
    when(() => mockApi.post('/api/travel-agents', data: any(named: 'data')))
        .thenThrow(serverError('/api/travel-agents'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tambah Travel Agent'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Nama'), 'Gagal');
    await tester.enterText(
      find.widgetWithText(TextField, 'Email'),
      'gagal@example.com',
    );
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    expect(
      find.text('Terjadi kesalahan pada server.'),
      findsOneWidget,
    );
  });

  testWidgets('Aktifkan re-invites a suspended agent', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubAgents();
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => ok('/api/travel-agents/a2', {}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Aktifkan').first);
    await tester.pumpAndSettle();
    expect(find.text('Travel agent diaktifkan kembali'), findsOneWidget);
  });

  testWidgets('status change shows error snackbar on failure', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubAgents();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenThrow(serverError('/api/travel-agents/a1'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Suspend'));
    await tester.pumpAndSettle();
    expect(
      find.text('Terjadi kesalahan pada server.'),
      findsOneWidget,
    );
  });
}
