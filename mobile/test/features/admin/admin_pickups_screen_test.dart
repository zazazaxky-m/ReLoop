import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_pickups_screen.dart';
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
            initialLocation: '/admin/pickups',
            routes: [
              GoRoute(
                path: '/admin/pickups',
                builder: (context, state) => const AdminPickupsScreen(),
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

  void stubLoad({List<Map<String, dynamic>>? pickups}) {
    when(() => mockApi.get('/api/pickups')).thenAnswer(
      (_) async => ok('/api/pickups', {
        'pickups': pickups ??
            [
              {
                'id': 'pk1',
                'status': 'REQUESTED',
                'version': 3,
                'reason': 'FULL',
                'priority': 2,
                'notes': 'Segera ambil',
                'machine': {'name': 'Mesin Pickup', 'machineCode': 'MAC-P1'},
                'assignedCollector': null,
                '_count': {'items': 5},
              },
              {
                'id': 'pk2',
                'status': 'COMPLETED',
                'reason': 'SCHEDULED',
                'priority': 0,
                'machine': {'name': 'Mesin Selesai', 'machineCode': 'MAC-P2'},
                'assignedCollector': {'name': 'Pengepul A'},
                '_count': {'items': 1},
              },
            ],
      }),
    );
    when(() => mockApi.get('/api/machines')).thenAnswer(
      (_) async => ok('/api/machines', {
        'machines': [
          {'id': 'm1', 'name': 'Mesin A', 'machineCode': 'MAC-A'},
        ],
      }),
    );
    when(() => mockApi.get(
          '/api/partnerships',
          queryParameters: any(named: 'queryParameters'),
        )).thenAnswer(
      (_) async => ok('/api/partnerships', {
        'partnerships': [
          {
            'collectorUser': {
              'id': 'cu1',
              'name': 'Pengepul A',
              'email': 'p@example.com',
            },
          },
        ],
      }),
    );
  }

  testWidgets('loads pickup list', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Pickup'), findsWidgets);
    expect(find.text('Buat Pickup'), findsOneWidget);
    expect(find.text('Mesin Pickup'), findsOneWidget);
    expect(find.text('Mesin Selesai'), findsOneWidget);
    expect(find.text('Tugaskan'), findsOneWidget);
    expect(find.text('Batalkan'), findsOneWidget);
    expect(find.textContaining('Segera ambil'), findsOneWidget);
  });

  testWidgets('empty state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad(pickups: []);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Tidak ada pickup.'), findsOneWidget);
  });

  testWidgets('shows retry on error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/pickups')).thenThrow(serverError('/api/pickups'));
    when(() => mockApi.get('/api/machines')).thenAnswer(
      (_) async => ok('/api/machines', {'machines': []}),
    );
    when(() => mockApi.get(
          '/api/partnerships',
          queryParameters: any(named: 'queryParameters'),
        )).thenAnswer(
      (_) async => ok('/api/partnerships', {'partnerships': []}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);
  });

  testWidgets('create pickup dialog posts', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.post('/api/pickups', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/pickups', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Pickup'));
    await tester.pumpAndSettle();
    expect(find.text('Buat Pickup Baru'), findsOneWidget);

    await tester.tap(find.text('Pilih mesin...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Mesin A').last);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(TextButton, 'Buat'));
    await tester.pumpAndSettle();

    verify(() => mockApi.post('/api/pickups', data: any(named: 'data')))
        .called(1);
  });

  testWidgets('assign collector dialog patches', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/pickups/pk1', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tugaskan'));
    await tester.pumpAndSettle();
    expect(find.text('Tugaskan Pengepul'), findsOneWidget);

    await tester.tap(find.text('Pilih pengepul...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Pengepul A').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tugaskan').last);
    await tester.pumpAndSettle();

    // B05: the dispatch carries the version the list showed.
    verify(() => mockApi.patch('/api/pickups/pk1',
        data: {'action': 'assign', 'expectedVersion': 3, 'collectorUserId': 'cu1'})).called(1);
  });

  testWidgets('cancel pickup patches', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/pickups/pk1', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Batalkan'));
    await tester.pumpAndSettle();
    expect(find.text('Alasan pembatalan'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Alasan pembatalan'), 'Mesin dipindah');
    await tester.tap(find.text('Batalkan Pickup'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/pickups/pk1',
        data: {'action': 'cancel', 'expectedVersion': 3, 'reason': 'Mesin dipindah'})).called(1);
  });

  testWidgets('cancel without a reason is not sent', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Batalkan'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Batalkan Pickup'));
    await tester.pumpAndSettle();
    expect(find.text('Alasan wajib diisi (3-500 karakter)'), findsOneWidget);
    verifyNever(() => mockApi.patch(any(), data: any(named: 'data')));
  });

  testWidgets('shows PIC, next step and deadline; creates a replacement task', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad(pickups: [
      {
        'id': 'pk5',
        'status': 'ASSIGNED',
        'version': 2,
        'reason': 'FULL',
        'priority': 0,
        'machine': {'name': 'Mesin Dispatch', 'machineCode': 'MAC-D'},
        'assignedCollector': {'name': 'Pengepul A'},
        'assignedAt': '2026-10-14T01:00:00.000Z',
        'expectedStartAt': '2026-10-14T03:00:00.000Z',
        'dispatch': {'nextLabel': 'Terlambat: pengepul belum berangkat', 'overdue': true, 'needsReplacement': false},
        '_count': {'items': 0},
      },
      {
        'id': 'pk6',
        'status': 'FAILED',
        'version': 4,
        'reason': 'FULL',
        'priority': 0,
        'closedReason': 'Akses jalan ditutup',
        'machine': {'name': 'Mesin Gagal', 'machineCode': 'MAC-G'},
        'assignedCollector': {'name': 'Pengepul B'},
        'dispatch': {'nextLabel': 'Menunggu admin membuat tugas pengganti', 'overdue': false, 'needsReplacement': true},
        '_count': {'items': 0},
      },
    ]);
    when(() => mockApi.post('/api/pickups', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/pickups', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Langkah berikutnya: Terlambat: pengepul belum berangkat'), findsOneWidget);
    expect(find.textContaining('PIC: Pengepul A'), findsOneWidget);
    expect(find.textContaining('(terlambat)'), findsOneWidget);
    expect(find.text('Ganti'), findsOneWidget);
    expect(find.text('Alasan: Akses jalan ditutup'), findsOneWidget);

    await tester.tap(find.text('Buat Pengganti'));
    await tester.pumpAndSettle();
    verify(() => mockApi.post('/api/pickups', data: {'replacesPickupId': 'pk6'})).called(1);
  });

  testWidgets('create pickup API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.post('/api/pickups', data: any(named: 'data')))
        .thenThrow(serverError('/api/pickups'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Pickup'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih mesin...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Mesin A').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Buat'));
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('create pickup with reason priority notes and act error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubLoad();
    when(() => mockApi.post('/api/pickups', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/pickups', {}));
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenThrow(serverError('/api/pickups/pk1'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Pickup'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih mesin...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Mesin A').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Manual'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Penuh').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('P0'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('P2').last);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextField, 'Catatan'),
      'Catatan uji',
    );
    await tester.tap(find.widgetWithText(TextButton, 'Buat'));
    await tester.pumpAndSettle();
    verify(() => mockApi.post('/api/pickups', data: any(named: 'data'))).called(1);

    await tester.tap(find.text('Batalkan'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Alasan pembatalan'), 'Uji galat');
    await tester.tap(find.text('Batalkan Pickup'));
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });
}
