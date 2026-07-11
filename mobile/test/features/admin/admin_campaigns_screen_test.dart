import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_campaigns_screen.dart';
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
            initialLocation: '/admin/campaigns',
            routes: [
              GoRoute(
                path: '/admin/campaigns',
                builder: (context, state) => const AdminCampaignsScreen(),
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

  List<Map<String, dynamic>> campaignsData() => [
        {
          'id': 'c1',
          'name': 'Campaign Plastik',
          'description': 'Program setor mesin',
          'campaignType': 'MACHINE_DEPOSIT',
          'rewardMode': 'MONEY_REWARD',
          'visibility': 'PUBLIC',
          'status': 'ACTIVE',
          'rewardMultiplier': 1.5,
          'startAt': '2026-01-01T00:00:00Z',
          'endAt': '2026-12-31T00:00:00Z',
          '_count': {'sessions': 3},
        },
        {
          'id': 'c2',
          'name': 'Campaign Privat',
          'campaignType': 'TRASH_BAG',
          'rewardMode': 'COMPLIANCE_ONLY',
          'visibility': 'PRIVATE',
          'status': 'DRAFT',
          'allowedEmailDomains': ['@reloop.id'],
        },
      ];

  void stubCampaigns([List<Map<String, dynamic>>? campaigns]) {
    when(() => mockApi.get('/api/campaigns')).thenAnswer(
      (_) async =>
          ok('/api/campaigns', {'campaigns': campaigns ?? campaignsData()}),
    );
  }

  testWidgets('loads campaign list', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCampaigns();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Campaign'), findsOneWidget);
    expect(find.text('Buat Campaign'), findsOneWidget);
    expect(find.text('Campaign Plastik'), findsOneWidget);
    expect(find.text('Campaign Privat'), findsOneWidget);
    expect(find.textContaining('Domain: @reloop.id'), findsOneWidget);
    expect(find.text('Deposit Mesin'), findsOneWidget);
    expect(find.text('Trash Bag'), findsOneWidget);
    expect(find.text('Edit'), findsWidgets);
    expect(find.text('Hapus'), findsWidgets);
  });

  testWidgets('empty state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCampaigns([]);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Belum ada campaign.'), findsOneWidget);
  });

  testWidgets('shows retry on error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/campaigns'))
        .thenThrow(serverError('/api/campaigns'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);
  });

  testWidgets('create campaign dialog posts', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCampaigns();
    when(() => mockApi.post('/api/campaigns', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/campaigns', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Campaign'));
    await tester.pumpAndSettle();
    expect(find.text('Campaign Baru'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, 'Nama'), 'Campaign Baru Test');
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    verify(() => mockApi.post('/api/campaigns', data: any(named: 'data')))
        .called(1);
  });

  testWidgets('edit campaign dialog patches', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCampaigns();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/campaigns/c1', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit').first);
    await tester.pumpAndSettle();
    expect(find.text('Edit Campaign'), findsOneWidget);
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    verify(() => mockApi.patch(any(), data: any(named: 'data'))).called(1);
  });

  testWidgets('delete campaign confirms and deletes', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCampaigns();
    when(() => mockApi.delete(any())).thenAnswer(
      (_) async => ok('/api/campaigns/c1', {}),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Hapus').first);
    await tester.pumpAndSettle();
    expect(find.text('Hapus Campaign?'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Hapus'));
    await tester.pumpAndSettle();

    verify(() => mockApi.delete(any())).called(1);
  });

  testWidgets('create campaign API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCampaigns();
    when(() => mockApi.post('/api/campaigns', data: any(named: 'data')))
        .thenThrow(serverError('/api/campaigns'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Campaign'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Nama'), 'Gagal');
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('delete campaign cancel keeps list', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCampaigns();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Hapus').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    expect(find.text('Campaign Plastik'), findsOneWidget);
    verifyNever(() => mockApi.delete(any()));
  });

  testWidgets('tourism and event campaign types render', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCampaigns([
      {
        'id': 'c3',
        'name': 'Wisata',
        'campaignType': 'TOURISM_PROGRAM',
        'rewardMode': 'COMPLIANCE_ONLY',
        'visibility': 'PUBLIC',
        'status': 'ACTIVE',
      },
      {
        'id': 'c4',
        'name': 'Event',
        'campaignType': 'EVENT',
        'rewardMode': 'MONEY_REWARD',
        'visibility': 'PUBLIC',
        'status': 'ENDED',
      },
    ]);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Wisata'), findsWidgets);
    expect(find.text('Event'), findsWidgets);
  });

  testWidgets('retry after load error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    var fail = true;
    when(() => mockApi.get('/api/campaigns')).thenAnswer((_) async {
      if (fail) {
        fail = false;
        throw serverError('/api/campaigns');
      }
      return ok('/api/campaigns', {'campaigns': []});
    });

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    expect(find.text('Coba Lagi'), findsOneWidget);
    await tester.tap(find.text('Coba Lagi'));
    await tester.pumpAndSettle();
    expect(find.text('Belum ada campaign.'), findsOneWidget);
  });

  testWidgets('create private campaign with domains and dropdowns', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubCampaigns();
    when(() => mockApi.post('/api/campaigns', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/campaigns', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Campaign'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Nama'), 'Privat Domains');
    await tester.enterText(
      find.widgetWithText(TextField, 'Deskripsi'),
      'Deskripsi campaign',
    );

    final dropdowns = find.byType(DropdownButtonFormField<String>);
    expect(dropdowns, findsWidgets);

    // Tipe -> Trash Bag
    await tester.tap(dropdowns.at(0));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Trash Bag').last);
    await tester.pumpAndSettle();

    // Mode Reward -> Compliance only
    await tester.tap(dropdowns.at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Compliance only').last);
    await tester.pumpAndSettle();

    // Visibilitas -> Privat
    await tester.tap(dropdowns.at(2));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Privat').last);
    await tester.pumpAndSettle();

    expect(find.text('Domain Email yang Diizinkan'), findsOneWidget);
    await tester.enterText(
      find.widgetWithText(TextField, 'Domain Email yang Diizinkan'),
      '@a.com\n@b.com\n',
    );

    // Status -> Aktif
    await tester.tap(dropdowns.at(3));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Aktif').last);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextField, 'Multiplier Reward'),
      '1.25',
    );

    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    verify(() => mockApi.post('/api/campaigns', data: any(named: 'data')))
        .called(1);
  });

  testWidgets('date pickers update start and end', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubCampaigns();
    when(() => mockApi.post('/api/campaigns', data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/campaigns', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Buat Campaign'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Nama'), 'Dengan Tanggal');

    await tester.tap(find.byIcon(Icons.calendar_today).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.calendar_today).last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();
    verify(() => mockApi.post('/api/campaigns', data: any(named: 'data')))
        .called(1);
  });

  testWidgets('delete campaign API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCampaigns();
    when(() => mockApi.delete(any())).thenThrow(serverError('/api/campaigns/c1'));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Hapus').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Hapus'));
    await tester.pumpAndSettle();

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('school program type label renders', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCampaigns([
      {
        'id': 'c5',
        'name': 'Sekolah',
        'campaignType': 'SCHOOL_PROGRAM',
        'rewardMode': 'COMPLIANCE_ONLY',
        'visibility': 'PUBLIC',
        'status': 'PAUSED',
      },
    ]);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    expect(find.text('Sekolah'), findsWidgets);
    expect(find.text('Dijeda'), findsOneWidget);
  });

  testWidgets('edit private campaign loads domains field', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubCampaigns();
    when(() => mockApi.patch(any(), data: any(named: 'data')))
        .thenAnswer((_) async => ok('/api/campaigns/c2', {}));

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit').last);
    await tester.pumpAndSettle();
    expect(find.text('Edit Campaign'), findsOneWidget);
    expect(find.text('Domain Email yang Diizinkan'), findsOneWidget);
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch(any(), data: any(named: 'data'))).called(1);
  });
}
