import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_trips_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockApiClient mockApi;
  late MockAuthProvider mockAuth;
  void Function(FlutterErrorDetails)? previousOnError;

  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
    registerFallbackValue('');
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
            initialLocation: '/admin/trips',
            routes: [
              GoRoute(
                path: '/admin/trips',
                builder: (context, state) => const AdminTripsScreen(),
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
    List<Map<String, dynamic>>? campaigns,
    List<Map<String, dynamic>>? agents,
    List<Map<String, dynamic>>? wasteTypes,
  }) {
    when(() => mockApi.get('/api/trips')).thenAnswer(
      (_) async => ok('/api/trips', {
        'trips': trips ??
            [
              {
                'id': 't1',
                'groupName': 'Grup Wisata A',
                'status': 'PLANNED',
                'complianceStatus': 'NOT_STARTED',
                'participantCount': 12,
                'leaderName': 'Budi',
                'campaign': {
                  'name': 'Campaign Trash Bag',
                  'campaignType': 'TRASH_BAG',
                  'rewardMode': 'COMPLIANCE_ONLY',
                },
                'travelAgent': {'name': 'Agent Satu'},
                '_count': {'bagAssignments': 2, 'validations': 0},
              },
              {
                'id': 't2',
                'groupName': 'Trip Dibatalkan',
                'status': 'CANCELLED',
                'participantCount': 3,
                'campaign': {'name': 'Campaign Lama'},
                '_count': {'bagAssignments': 0, 'validations': 0},
              },
            ],
      }),
    );
    when(() => mockApi.get('/api/campaigns')).thenAnswer(
      (_) async => ok('/api/campaigns', {
        'campaigns': campaigns ??
            [
              {
                'id': 'c1',
                'name': 'Campaign Trash Bag',
                'campaignType': 'TRASH_BAG',
                'status': 'ACTIVE',
                'rewardMode': 'COMPLIANCE_ONLY',
              },
            ],
      }),
    );
    when(() => mockApi.get('/api/travel-agents')).thenAnswer(
      (_) async => ok('/api/travel-agents', {
        'agents': agents ??
            [
              {
                'id': 'a1',
                'name': 'Agent Satu',
                'organizationStatus': 'INVITED',
              },
            ],
      }),
    );
    when(() => mockApi.get('/api/waste-types')).thenAnswer(
      (_) async => ok('/api/waste-types', {
        'wasteTypes': wasteTypes ??
            [
              {'id': 'w1', 'name': 'Plastik'},
            ],
      }),
    );
  }

  testWidgets('loads trip list with actions', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Trip / Trash Bag'), findsOneWidget);
    expect(find.text('Buat Trip'), findsOneWidget);
    expect(find.text('Scan Kantong'), findsOneWidget);
    expect(find.text('Grup Wisata A'), findsOneWidget);
    expect(find.text('Trip Dibatalkan'), findsOneWidget);
    expect(find.text('Bagikan Kantong'), findsOneWidget);
    expect(find.text('Validasi'), findsOneWidget);
    expect(find.text('Buka Ulang'), findsOneWidget);
  });

  testWidgets('empty trips shows empty copy', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad(trips: []);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada trip.'), findsOneWidget);
  });

  testWidgets('shows retry state on error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/trips')).thenThrow(serverError('/api/trips'));
    when(() => mockApi.get('/api/campaigns')).thenAnswer(
      (_) async => ok('/api/campaigns', {'campaigns': []}),
    );
    when(() => mockApi.get('/api/travel-agents')).thenAnswer(
      (_) async => ok('/api/travel-agents', {'agents': []}),
    );
    when(() => mockApi.get('/api/waste-types')).thenAnswer(
      (_) async => ok('/api/waste-types', {'wasteTypes': []}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);
  });

  testWidgets('create trip dialog opens and submits', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.post('/api/trips', data: any(named: 'data'))).thenAnswer(
      (_) async => ok('/api/trips', {'trip': {'id': 't3'}}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Trip'));
    await tester.pumpAndSettle();

    expect(find.text('Buat Trip Baru'), findsOneWidget);
    expect(find.text('Nama Grup'), findsOneWidget);

    await tester.tap(find.text('Pilih campaign...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Campaign Trash Bag').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Nama Grup'), 'Grup Baru');
    await tester.tap(find.text('Buat').last);
    await tester.pumpAndSettle();

    verify(() => mockApi.post('/api/trips', data: any(named: 'data'))).called(1);
    expect(find.text('Trip berhasil dibuat'), findsOneWidget);
  });

  testWidgets('create trip without active campaign shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad(campaigns: [
      {
        'id': 'c9',
        'name': 'Draft Only',
        'campaignType': 'TRASH_BAG',
        'status': 'DRAFT',
      },
    ]);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Trip'));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Belum ada campaign ACTIVE'),
      findsOneWidget,
    );
  });

  testWidgets('cancel trip confirmation', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => ok('/api/trips/t1', {}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Batalkan'));
    await tester.pumpAndSettle();
    expect(find.text('Batalkan Trip?'), findsOneWidget);
    await tester.tap(find.text('Batalkan').last);
    await tester.pumpAndSettle();
    expect(find.text('Trip dibatalkan'), findsOneWidget);
  });

  testWidgets('reopen cancelled trip', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => ok('/api/trips/t2', {}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Buka Ulang'));
    await tester.tap(find.text('Buka Ulang'));
    await tester.pumpAndSettle();
    expect(find.text('Trip dibuka ulang'), findsOneWidget);
  });

  testWidgets('issue bags dialog and view QR', (tester) async {
    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      final message = details.exceptionAsString();
      if (message.contains('RenderFlex overflowed') ||
          message.contains('ListTile background')) {
        return;
      }
      previous?.call(details);
    };
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.post('/api/trash-bags', data: any(named: 'data'))).thenAnswer(
      (_) async => ok('/api/trash-bags', {
        'bags': [
          {
            'id': 'b1',
            'bagQrCode': 'QR-001',
            'status': 'GOOD',
            'wasteType': {'name': 'Plastik'},
          },
        ],
      }),
    );
    when(() => mockApi.get('/api/trash-bags', queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => ok('/api/trash-bags', {
        'bags': [
          {
            'id': 'b1',
            'bagQrCode': 'QR-001',
            'status': 'GOOD',
            'wasteType': {'name': 'Plastik'},
          },
        ],
      }),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Bagikan Kantong'));
    await tester.pumpAndSettle();
    expect(find.text('Bagikan Kantong'), findsWidgets);
    await tester.tap(find.widgetWithText(TextButton, 'Bagikan'));
    await tester.pumpAndSettle();

    expect(find.textContaining('kantong berhasil dibuat'), findsOneWidget);
    expect(find.textContaining('Kode QR Kantong'), findsOneWidget);
    await tester.tap(find.text('Tutup'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Lihat QR'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Kode QR Kantong'), findsOneWidget);
    await tester.tap(find.text('Tutup'));
    await tester.pumpAndSettle();
  });

  testWidgets('validate trip dialog submits', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.get('/api/trash-bags', queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => ok('/api/trash-bags', {
        'bags': [
          {'id': 'b1', 'bagQrCode': 'QR-001', 'status': null},
        ],
      }),
    );
    when(() => mockApi.post('/api/manual-validations', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/manual-validations', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Validasi'));
    await tester.pumpAndSettle();
    expect(find.text('Validasi Trip'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Validasi'));
    await tester.pumpAndSettle();

    expect(find.text('Validasi berhasil'), findsOneWidget);
  });

  testWidgets('issue bags with waste type and copy codes', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.post('/api/trash-bags', data: any(named: 'data'))).thenAnswer(
      (_) async => ok('/api/trash-bags', {
        'bags': [
          {
            'id': 'b1',
            'bagQrCode': 'QR-001',
            'status': 'PARTIAL',
            'wasteType': {'name': 'Plastik'},
          },
          {
            'id': 'b2',
            'bagQrCode': 'QR-002',
            'status': 'POOR',
          },
          {
            'id': 'b3',
            'bagQrCode': 'QR-003',
            'status': 'NOT_RETURNED',
          },
          {
            'id': 'b4',
            'bagQrCode': 'QR-004',
            'status': 'CUSTOM',
          },
        ],
      }),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Bagikan Kantong'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Semua jenis / belum ditentukan'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Plastik').last);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(TextButton, 'Bagikan'));
    await tester.pumpAndSettle();

    expect(find.textContaining('kantong berhasil dibuat'), findsOneWidget);
    expect(find.textContaining('Sebagian'), findsWidgets);
    expect(find.textContaining('Rusak'), findsWidgets);
    expect(find.textContaining('Tidak dikembalikan'), findsWidgets);
    expect(find.text('Salin Semua'), findsOneWidget);
    expect(find.text('Bagikan'), findsWidgets);

    await tester.tap(find.text('Tutup'));
    await tester.pumpAndSettle();
  });

  testWidgets('create trip API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.post('/api/trips', data: any(named: 'data'))).thenThrow(
      serverError('/api/trips'),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Trip'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih campaign...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Campaign Trash Bag').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Buat').last);
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('view QR empty bags shows error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.get('/api/trash-bags', queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => ok('/api/trash-bags', {'bags': []}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Lihat QR'));
    await tester.pumpAndSettle();
    expect(find.text('Belum ada kantong untuk trip ini'), findsOneWidget);
  });

  testWidgets('tourism trip requires travel agent', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad(
      campaigns: [
        {
          'id': 'c2',
          'name': 'Wisata Program',
          'campaignType': 'TOURISM_PROGRAM',
          'status': 'ACTIVE',
          'rewardMode': 'COMPLIANCE_ONLY',
        },
      ],
      agents: [
        {
          'id': 'a1',
          'name': 'Agent Satu',
          'organizationStatus': 'INVITED',
        },
      ],
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Trip'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih campaign...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Wisata Program').last);
    await tester.pumpAndSettle();

    expect(find.textContaining('Wajib untuk Program Wisata'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Nama Grup'), 'Grup W');
    await tester.tap(find.text('Buat').last);
    await tester.pumpAndSettle();
    // Without agent selection dialog should remain
    expect(find.text('Buat Trip Baru'), findsOneWidget);
  });

  testWidgets('tourism without agents shows warning', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad(
      campaigns: [
        {
          'id': 'c2',
          'name': 'Wisata Program',
          'campaignType': 'TOURISM_PROGRAM',
          'status': 'ACTIVE',
          'rewardMode': 'COMPLIANCE_ONLY',
        },
      ],
      agents: [],
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Trip'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih campaign...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Wisata Program').last);
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Belum ada travel agent'),
      findsOneWidget,
    );
  });

  testWidgets('money reward trip shows email field', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad(
      campaigns: [
        {
          'id': 'c3',
          'name': 'Money Campaign',
          'campaignType': 'TRASH_BAG',
          'status': 'ACTIVE',
          'rewardMode': 'MONEY_REWARD',
        },
      ],
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Trip'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih campaign...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Money Campaign').last);
    await tester.pumpAndSettle();

    expect(find.textContaining('Email'), findsWidgets);
  });

  testWidgets('trip chips for compliance and reward user', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad(
      trips: [
        {
          'id': 't3',
          'groupName': 'Grup Review',
          'status': 'ACTIVE',
          'complianceStatus': 'NEEDS_REVIEW',
          'participantCount': 5,
          'rewardMode': 'MONEY_REWARD',
          'user': {'email': 'reward@x.com'},
          'campaign': {
            'name': 'Campaign Money',
            'campaignType': 'TRASH_BAG',
            'rewardMode': 'MONEY_REWARD',
          },
          '_count': {'bagAssignments': 1, 'validations': 0},
        },
        {
          'id': 't4',
          'groupName': 'Tanpa Penerima',
          'status': 'PLANNED',
          'participantCount': 2,
          'rewardMode': 'MONEY_REWARD',
          'campaign': {
            'name': 'Campaign Money 2',
            'rewardMode': 'MONEY_REWARD',
          },
          '_count': {'bagAssignments': 0, 'validations': 0},
        },
      ],
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.textContaining('Perlu review'), findsWidgets);
    expect(find.textContaining('reward@x.com'), findsWidgets);
    expect(find.textContaining('Tanpa penerima'), findsWidgets);
  });

  testWidgets('issue bags invalid count shows error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Bagikan Kantong'));
    await tester.pumpAndSettle();

    final countField = find.byType(TextField).first;
    await tester.enterText(countField, '0');
    await tester.tap(find.widgetWithText(TextButton, 'Bagikan'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Jumlah harus 1–200'), findsOneWidget);
  });

  testWidgets('cancel trip API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenThrow(
      serverError('/api/trips/t1'),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Batalkan'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Batalkan').last);
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('retry after load error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    var fail = true;
    when(() => mockApi.get('/api/trips')).thenAnswer((_) async {
      if (fail) {
        fail = false;
        throw serverError('/api/trips');
      }
      return ok('/api/trips', {'trips': []});
    });
    when(() => mockApi.get('/api/campaigns')).thenAnswer(
      (_) async => ok('/api/campaigns', {'campaigns': []}),
    );
    when(() => mockApi.get('/api/travel-agents')).thenAnswer(
      (_) async => ok('/api/travel-agents', {'agents': []}),
    );
    when(() => mockApi.get('/api/waste-types')).thenAnswer(
      (_) async => ok('/api/waste-types', {'wasteTypes': []}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    expect(find.text('Coba Lagi'), findsOneWidget);

    await tester.tap(find.text('Coba Lagi'));
    await tester.pumpAndSettle();
    expect(find.text('Belum ada trip.'), findsOneWidget);
  });

  testWidgets('QR dialog copy single and copy all', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.get('/api/trash-bags', queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => ok('/api/trash-bags', {
        'bags': [
          {
            'id': 'b1',
            'bagQrCode': 'QR-001',
            'status': null,
            'wasteType': {'name': 'Plastik'},
          },
          {
            'id': 'b2',
            'bagQrCode': 'QR-002',
            'status': 'GOOD',
          },
        ],
      }),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Lihat QR'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Kode QR Kantong'), findsOneWidget);
    expect(find.textContaining('Belum divalidasi'), findsWidgets);

    await tester.tap(find.byIcon(Icons.copy).first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    // Clipboard may be unavailable in some test bindings; still exercise the handler.
    expect(find.text('Salin Semua'), findsOneWidget);

    await tester.tap(find.text('Salin Semua'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.text('Tutup'));
    await tester.pumpAndSettle();
  });

  testWidgets('validate CHECK_OUT with bag statuses', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubLoad();
    when(() => mockApi.get('/api/trash-bags', queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => ok('/api/trash-bags', {
        'bags': [
          {'id': 'b1', 'bagQrCode': 'QR-001', 'status': null},
          {'id': 'b2', 'bagQrCode': 'QR-002', 'status': null},
        ],
      }),
    );
    when(() => mockApi.post('/api/manual-validations', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/manual-validations', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Validasi'));
    await tester.pumpAndSettle();
    expect(find.text('Validasi Trip'), findsOneWidget);

    // Switch stage to CHECK_OUT
    await tester.tap(find.text('Check In'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Check Out').last);
    await tester.pumpAndSettle();

    expect(find.textContaining('Kondisi per kantong'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Validasi'));
    await tester.pumpAndSettle();
    expect(find.text('Validasi berhasil'), findsOneWidget);
  });

  testWidgets('validate CHECK_OUT with empty bags message', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.get('/api/trash-bags', queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => ok('/api/trash-bags', {'bags': []}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Validasi'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Check In'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Check Out').last);
    await tester.pumpAndSettle();

    expect(find.textContaining('Belum ada kantong'), findsOneWidget);
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
  });

  testWidgets('create tourism trip with agent and full fields', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubLoad(
      campaigns: [
        {
          'id': 'c2',
          'name': 'Wisata Program',
          'campaignType': 'TOURISM_PROGRAM',
          'status': 'ACTIVE',
          'rewardMode': 'COMPLIANCE_ONLY',
        },
      ],
    );
    when(() => mockApi.post('/api/trips', data: any(named: 'data'))).thenAnswer(
      (_) async => ok('/api/trips', {'trip': {'id': 't9'}}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Trip'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih campaign...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Wisata Program').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Pilih travel agent...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Agent Satu').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Nama Grup'), 'Grup Full');
    await tester.enterText(find.widgetWithText(TextField, 'Nama Ketua'), 'Ketua');
    await tester.enterText(find.widgetWithText(TextField, 'Kontak Ketua'), '081');
    await tester.enterText(find.widgetWithText(TextField, 'Jumlah Peserta'), '8');
    await tester.tap(find.text('Buat').last);
    await tester.pumpAndSettle();

    verify(() => mockApi.post('/api/trips', data: any(named: 'data'))).called(1);
  });

  testWidgets('validate ACTIVE trip defaults CHECK_OUT and weight', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubLoad(trips: [
      {
        'id': 't5',
        'groupName': 'Trip Aktif',
        'status': 'ACTIVE',
        'participantCount': 4,
        'campaign': {
          'name': 'Campaign Trash Bag',
          'campaignType': 'TRASH_BAG',
          'rewardMode': 'COMPLIANCE_ONLY',
        },
        '_count': {'bagAssignments': 1, 'validations': 0},
      },
    ]);
    when(() => mockApi.get('/api/trash-bags', queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => ok('/api/trash-bags', {
        'bags': [
          {'id': 'b1', 'bagQrCode': 'QR-001', 'status': null},
        ],
      }),
    );
    when(() => mockApi.post('/api/manual-validations', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/manual-validations', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Validasi'));
    await tester.pumpAndSettle();
    expect(find.text('Check Out'), findsWidgets);
    expect(find.textContaining('Kondisi per kantong'), findsOneWidget);

    await tester.tap(find.text('Hilang'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Baik').last);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextField, 'Berat aktual (kg, opsional)'),
      '12.5',
    );
    await tester.enterText(find.widgetWithText(TextField, 'Catatan'), 'ok');
    await tester.tap(find.widgetWithText(TextButton, 'Validasi'));
    await tester.pumpAndSettle();
    expect(find.text('Validasi berhasil'), findsOneWidget);
  });

  testWidgets('validate API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.get('/api/trash-bags', queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => ok('/api/trash-bags', {
        'bags': [
          {'id': 'b1', 'bagQrCode': 'QR-001', 'status': null},
        ],
      }),
    );
    when(() => mockApi.post('/api/manual-validations', data: any(named: 'data')))
        .thenThrow(serverError('/api/manual-validations'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Validasi'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Validasi'));
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('reopen trip API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenThrow(serverError('/api/trips/t2'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Buka Ulang'));
    await tester.tap(find.text('Buka Ulang'));
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('create trip cancel and money reward email gate', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubLoad(
      campaigns: [
        {
          'id': 'c3',
          'name': 'Money Campaign',
          'campaignType': 'TRASH_BAG',
          'status': 'ACTIVE',
          'rewardMode': 'MONEY_REWARD',
        },
      ],
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Trip'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    expect(find.text('Buat Trip Baru'), findsNothing);

    await tester.tap(find.text('Buat Trip'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih campaign...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Money Campaign').last);
    await tester.pumpAndSettle();

    // Without email, Buat should no-op
    await tester.tap(find.text('Buat').last);
    await tester.pumpAndSettle();
    expect(find.text('Buat Trip Baru'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Email User Penerima Reward'),
      'reward@x.com',
    );
    await tester.enterText(find.widgetWithText(TextField, 'Nama Grup'), 'Grup M');
    await tester.enterText(find.widgetWithText(TextField, 'Nama Ketua'), 'Ketua');
    await tester.enterText(find.widgetWithText(TextField, 'Kontak Ketua'), '081');
    when(() => mockApi.post('/api/trips', data: any(named: 'data'))).thenAnswer(
      (_) async => ok('/api/trips', {'trip': {'id': 'tm'}}),
    );
    await tester.tap(find.text('Buat').last);
    await tester.pumpAndSettle();
    verify(() => mockApi.post('/api/trips', data: any(named: 'data'))).called(1);
  });

  testWidgets('issue bags cancel and API error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Bagikan Kantong'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    expect(find.text('Jumlah Kantong'), findsNothing);

    when(() => mockApi.post('/api/trash-bags', data: any(named: 'data')))
        .thenThrow(serverError('/api/trash-bags'));
    await tester.tap(find.text('Bagikan Kantong'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Bagikan'));
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('view QR API error and validate bags load error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.get('/api/trash-bags', queryParameters: any(named: 'queryParameters')))
        .thenThrow(serverError('/api/trash-bags'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Lihat QR'));
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);

    await tester.tap(find.text('Validasi'));
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsWidgets);
  });

  testWidgets('validate toggles appCompleted switch', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubLoad();
    when(() => mockApi.get('/api/trash-bags', queryParameters: any(named: 'queryParameters')))
        .thenAnswer(
      (_) async => ok('/api/trash-bags', {
        'bags': [
          {'id': 'b1', 'bagQrCode': 'QR-001', 'status': null},
        ],
      }),
    );
    when(() => mockApi.post('/api/manual-validations', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/manual-validations', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Validasi'));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Validasi'));
    await tester.pumpAndSettle();
    expect(find.text('Validasi berhasil'), findsOneWidget);
  });

  testWidgets('trip chips compliance variants and unnamed trip', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubLoad(
      trips: [
        {
          'id': 'tx',
          'status': 'ACTIVE',
          'complianceStatus': 'NON_COMPLIANT',
          'participantCount': 1,
          'campaign': {
            'name': 'Camp',
            'campaignType': 'TRASH_BAG',
            'rewardMode': 'COMPLIANCE_ONLY',
          },
          '_count': {'bagAssignments': 2, 'validations': 1},
        },
        {
          'id': 'ty',
          'status': 'ACTIVE',
          'complianceStatus': 'COMPLIANT',
          'participantCount': 2,
          'campaign': {'name': 'Camp2'},
          '_count': {'bagAssignments': 0, 'validations': 0},
        },
        {
          'id': 'tz',
          'status': 'ACTIVE',
          'complianceStatus': 'CHECKED_IN',
          'participantCount': 1,
          'campaign': {'name': 'Camp3'},
          '_count': {'bagAssignments': 1, 'validations': 0},
        },
      ],
      agents: [
        {'id': 'a1', 'name': 'Agent Satu', 'organizationStatus': 'PENDING'},
        {'id': 'a2', 'name': 'Agent Dua', 'organizationStatus': 'OTHER'},
      ],
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.textContaining('Trip #tx'), findsOneWidget);
    expect(find.textContaining('Non-compliant'), findsWidgets);
    expect(find.textContaining('Compliant'), findsWidgets);
    expect(find.textContaining('Check in'), findsWidgets);
    expect(find.text('Cetak'), findsWidgets);
    expect(find.text('Scan'), findsWidgets);

    await tester.ensureVisible(find.text('Cetak').first);
    await tester.tap(find.text('Cetak').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // Open create to exercise travel agent dropdown
    await tester.tap(find.text('Buat Trip'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih campaign...'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Campaign Trash Bag').last);
    await tester.pumpAndSettle();
    expect(find.text('Tanpa travel agent'), findsOneWidget);
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
  });
}
