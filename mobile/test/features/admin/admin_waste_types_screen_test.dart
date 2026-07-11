import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_waste_types_screen.dart';
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
            initialLocation: '/admin/waste-types',
            routes: [
              GoRoute(
                path: '/admin/waste-types',
                builder: (context, state) => const AdminWasteTypesScreen(),
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
    List<Map<String, dynamic>>? wasteTypes,
    List<Map<String, dynamic>>? rates,
    List<Map<String, dynamic>>? campaigns,
  }) {
    when(() => mockApi.get('/api/waste-types')).thenAnswer(
      (_) async => ok('/api/waste-types', {
        'wasteTypes': wasteTypes ??
            [
              {
                'id': 'w1',
                'name': 'Plastik PET',
                'unit': 'ITEM',
                'active': true,
                'defaultRewardPerItem': 200,
                'minWeightGrams': 10,
                'maxWeightGrams': 50,
                'organizationId': 'org1',
              },
              {
                'id': 'w2',
                'name': 'Kaleng Global',
                'unit': 'KG',
                'active': false,
                'organizationId': null,
              },
            ],
      }),
    );
    when(() => mockApi.get('/api/reward-rates')).thenAnswer(
      (_) async => ok('/api/reward-rates', {
        'rates': rates ??
            [
              {
                'id': 'r1',
                'pointsPerItem': 100,
                'active': true,
                'minWeightGrams': 5,
                'maxWeightGrams': 40,
                'effectiveFrom': '2026-01-01T00:00:00Z',
                'wasteType': {'name': 'Plastik PET'},
                'organization': {'name': 'Org A'},
              },
            ],
      }),
    );
    when(() => mockApi.get('/api/campaigns')).thenAnswer(
      (_) async => ok('/api/campaigns', {
        'campaigns': campaigns ??
            [
              {'id': 'c1', 'name': 'Campaign A'},
            ],
      }),
    );
  }

  testWidgets('loads waste types tab', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Jenis Sampah & Tarif'), findsOneWidget);
    expect(find.text('Jenis Sampah'), findsOneWidget);
    expect(find.text('Tarif Reward'), findsOneWidget);
    expect(find.text('Tambah Jenis'), findsOneWidget);
    expect(find.text('Plastik PET'), findsOneWidget);
    expect(find.text('Kaleng Global'), findsOneWidget);
    expect(find.text('Nonaktif'), findsOneWidget);
    expect(find.text('Aktif'), findsWidgets);
    expect(find.text('Hapus'), findsOneWidget);
  });

  testWidgets('switches to rates tab', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tarif Reward'));
    await tester.pumpAndSettle();

    expect(find.text('Tambah Tarif'), findsOneWidget);
    expect(find.text('Plastik PET'), findsWidgets);
    expect(find.text('Nonaktifkan'), findsOneWidget);
  });

  testWidgets('empty states on both tabs', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad(wasteTypes: [], rates: []);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada jenis sampah.'), findsOneWidget);

    await tester.tap(find.text('Tarif Reward'));
    await tester.pumpAndSettle();
    expect(find.text('Belum ada tarif.'), findsOneWidget);
  });

  testWidgets('shows retry on error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/waste-types'))
        .thenThrow(serverError('/api/waste-types'));
    when(() => mockApi.get('/api/reward-rates')).thenAnswer(
      (_) async => ok('/api/reward-rates', {'rates': []}),
    );
    when(() => mockApi.get('/api/campaigns')).thenAnswer(
      (_) async => ok('/api/campaigns', {'campaigns': []}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);
  });

  testWidgets('create waste type posts', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.post('/api/waste-types', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/waste-types', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tambah Jenis'));
    await tester.pumpAndSettle();
    expect(find.text('Jenis Sampah Baru'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, 'Nama'), 'Kaca');
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    verify(() => mockApi.post('/api/waste-types', data: any(named: 'data')))
        .called(1);
  });

  testWidgets('create waste type can change unit and shows snackbar on API error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubLoad();
    when(() => mockApi.post('/api/waste-types', data: any(named: 'data')))
        .thenThrow(serverError('/api/waste-types'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tambah Jenis'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Nama'), 'Kertas');

    await tester.tap(find.text('ITEM (per pcs)').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('KG (timbang)').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Simpan'));
    await tester.pump();

    final captured = verify(
      () => mockApi.post('/api/waste-types', data: captureAny(named: 'data')),
    ).captured.single as Map<String, dynamic>;
    expect(captured['unit'], 'KG');
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('edit and toggle waste type', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/waste-types/w1', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit').first);
    await tester.pumpAndSettle();
    expect(find.text('Edit Jenis Sampah'), findsOneWidget);
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Nonaktif'));
    await tester.pumpAndSettle();

    verify(() => mockApi.patch(any(), data: any(named: 'data')))
        .called(greaterThanOrEqualTo(2));
  });

  testWidgets('toggle waste type API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenThrow(serverError('/api/waste-types/w1'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Nonaktif'));
    await tester.pump();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('delete waste type confirms', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.delete(any()))
        .thenAnswer((_) async => ok('/api/waste-types/w1', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Hapus'));
    await tester.pumpAndSettle();
    expect(find.text('Nonaktifkan Jenis Sampah?'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Nonaktifkan'));
    await tester.pumpAndSettle();

    verify(() => mockApi.delete(any())).called(1);
  });

  testWidgets('delete waste type API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.delete(any()))
        .thenThrow(serverError('/api/waste-types/w1'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Hapus'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Nonaktifkan'));
    await tester.pump();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('create rate and toggle rate', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.post('/api/reward-rates', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/reward-rates', {}));
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/reward-rates/r1', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tarif Reward'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tambah Tarif'));
    await tester.pumpAndSettle();
    expect(find.text('Tarif Baru'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Poin per unit'),
      '50',
    );
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    verify(() => mockApi.post('/api/reward-rates', data: any(named: 'data')))
        .called(1);

    await tester.tap(find.text('Nonaktifkan'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch(any(), data: any(named: 'data'))).called(1);
  });

  testWidgets('rates tab renders campaign scope and create rate dropdown changes', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubLoad(
      wasteTypes: [
        {
          'id': 'w1',
          'name': 'Plastik PET',
          'unit': 'ITEM',
          'active': true,
          'organizationId': 'org1',
        },
        {
          'id': 'w3',
          'name': 'Kertas',
          'unit': 'KG',
          'active': true,
          'organizationId': 'org1',
        },
      ],
      rates: [
        {
          'id': 'r2',
          'pointsPerItem': 250,
          'active': true,
          'minWeightGrams': 20,
          'maxWeightGrams': 100,
          'effectiveFrom': '2026-01-01T00:00:00Z',
          'effectiveTo': '2026-12-31T00:00:00Z',
          'wasteType': {'name': 'Kertas'},
          'campaign': {'name': 'Campaign A'},
        },
      ],
    );
    when(() => mockApi.post('/api/reward-rates', data: any(named: 'data')))
        .thenThrow(serverError('/api/reward-rates'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tarif Reward'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Campaign: Campaign A'), findsOneWidget);
    expect(find.textContaining('s/d 2026-12-31'), findsOneWidget);

    await tester.tap(find.text('Tambah Tarif'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Plastik PET').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Kertas').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('ITEM (per pcs)').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('KG (per kilogram)').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Global / Organisasi').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Campaign A').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Poin per unit'), '75');
    await tester.tap(find.text('Simpan'));
    await tester.pump();

    final captured = verify(
      () => mockApi.post('/api/reward-rates', data: captureAny(named: 'data')),
    ).captured.single as Map<String, dynamic>;
    expect(captured['wasteTypeId'], 'w3');
    expect(captured['unit'], 'KG');
    expect(captured['campaignId'], 'c1');
    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('toggle rate API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubLoad();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenThrow(serverError('/api/reward-rates/r1'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Tarif Reward'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Nonaktifkan'));
    await tester.pump();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });
}
