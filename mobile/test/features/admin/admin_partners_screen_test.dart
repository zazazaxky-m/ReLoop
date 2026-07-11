import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_partners_screen.dart';
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
            initialLocation: '/admin/partners',
            routes: [
              GoRoute(
                path: '/admin/partners',
                builder: (context, state) => const AdminPartnersScreen(),
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

  List<Map<String, dynamic>> partnersData() => [
        {
          'id': 'p1',
          'status': 'REQUESTED',
          'collectorUser': {
            'name': 'Pengepul Diminta',
            'email': 'req@example.com',
            'phone': '08111',
          },
          'organization': {'name': 'Org A'},
          'serviceAreaJson': {
            'regions': ['Jakarta', 'Depok'],
          },
        },
        {
          'id': 'p2',
          'status': 'ACTIVE',
          'collectorUser': {
            'name': 'Pengepul Aktif',
            'email': 'act@example.com',
          },
        },
        {
          'id': 'p3',
          'status': 'SUSPENDED',
          'collectorUser': {
            'name': 'Pengepul Suspend',
            'email': 'sus@example.com',
          },
        },
        {
          'id': 'p4',
          'status': 'INVITED',
          'collectorUser': {
            'name': 'Pengepul Diundang',
            'email': 'inv@example.com',
          },
        },
      ];

  void stubPartners([List<Map<String, dynamic>>? partners]) {
    when(() => mockApi.get('/api/partnerships')).thenAnswer(
      (_) async =>
          ok('/api/partnerships', {'partnerships': partners ?? partnersData()}),
    );
  }

  testWidgets('loads partners list with actions', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubPartners();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Mitra Pengepul'), findsOneWidget);
    expect(find.text('Undang Pengepul'), findsOneWidget);
    expect(find.text('Pengepul Diminta'), findsOneWidget);
    expect(find.text('Pengepul Aktif'), findsOneWidget);
    expect(find.text('Terima'), findsOneWidget);
    expect(find.text('Tolak'), findsOneWidget);
    expect(find.text('Tangguhkan'), findsOneWidget);
    expect(find.text('Aktifkan'), findsOneWidget);
    expect(find.textContaining('Wilayah: Jakarta, Depok'), findsOneWidget);
  });

  testWidgets('filter chips filter list', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubPartners();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilterChip, 'Aktif'));
    await tester.pumpAndSettle();

    expect(find.text('Pengepul Aktif'), findsOneWidget);
    expect(find.text('Pengepul Diminta'), findsNothing);

    await tester.tap(find.widgetWithText(FilterChip, 'Semua'));
    await tester.pumpAndSettle();
    expect(find.text('Pengepul Diminta'), findsOneWidget);
  });

  testWidgets('empty filtered state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubPartners([]);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada mitra.'), findsOneWidget);
  });

  testWidgets('shows retry on error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/partnerships'))
        .thenThrow(serverError('/api/partnerships'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);
  });

  testWidgets('invite dialog posts', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubPartners();
    when(() => mockApi.post('/api/partnerships', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/partnerships', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Undang Pengepul'));
    await tester.pumpAndSettle();
    expect(find.text('Undang Pengepul'), findsWidgets);

    await tester.enterText(
      find.widgetWithText(TextField, 'Email pengepul'),
      'baru@example.com',
    );
    await tester.tap(find.text('Undang'));
    await tester.pumpAndSettle();

    expect(find.text('Undangan dikirim'), findsOneWidget);
  });

  testWidgets('accept partnership action', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubPartners();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/partnerships/p1', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Terima'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch(any(), data: any(named: 'data'))).called(1);
  });

  testWidgets('suspend partnership action', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubPartners();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/partnerships/p2', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Tangguhkan'));
    await tester.tap(find.text('Tangguhkan'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch(any(), data: any(named: 'data'))).called(1);
  });

  testWidgets('remove confirms dialog', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubPartners();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/partnerships/p2', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Hapus').first);
    await tester.pumpAndSettle();
    expect(find.text('Hapus Kemitraan?'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Hapus'));
    await tester.pumpAndSettle();

    verify(() => mockApi.patch(any(), data: any(named: 'data'))).called(1);
  });

  testWidgets('invite API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubPartners();
    when(() => mockApi.post('/api/partnerships', data: any(named: 'data')))
        .thenThrow(serverError('/api/partnerships'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Undang Pengepul'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Email pengepul'),
      'fail@example.com',
    );
    await tester.tap(find.text('Undang'));
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('act failure shows error snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubPartners();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenThrow(serverError('/api/partnerships/p1'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Terima'));
    await tester.pumpAndSettle();
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('pending superadmin approval shows hapus', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubPartners([
      {
        'id': 'p5',
        'status': 'PENDING_SUPERADMIN_APPROVAL',
        'collectorUser': {
          'name': 'Menunggu SA',
          'email': 'sa@example.com',
        },
      },
    ]);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Menunggu SA'), findsOneWidget);
    expect(find.text('Hapus'), findsOneWidget);
  });
}
