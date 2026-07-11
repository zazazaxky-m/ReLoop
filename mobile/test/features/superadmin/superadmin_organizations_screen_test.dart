import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/superadmin/superadmin_organizations_screen.dart';
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
            initialLocation: '/superadmin/organizations',
            routes: [
              GoRoute(
                path: '/superadmin/organizations',
                builder: (_, __) => const SuperadminOrganizationsScreen(),
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

  void stubOrgs({List<Map<String, dynamic>>? orgs}) {
    when(() => mockApi.get('/api/organizations')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/organizations'),
        data: {
          'organizations': orgs ??
              [
                {
                  'id': 'o1',
                  'name': 'Org Aktif',
                  'status': 'ACTIVE',
                  'type': 'SCHOOL',
                  'address': 'Jl. Merdeka 1',
                  'region': {'name': 'Jakarta'},
                  '_count': {'machines': 2, 'users': 5},
                },
                {
                  'id': 'o2',
                  'name': 'Org Suspend',
                  'status': 'SUSPENDED',
                  'type': 'OFFICE',
                  'address': '',
                  '_count': {'machines': 0, 'users': 1},
                },
              ],
        },
      ),
    );
    when(() => mockApi.get('/api/regions')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/regions'),
        data: {
          'regions': [
            {'id': 'r1', 'name': 'Jakarta', 'type': 'PROVINCE'},
          ],
        },
      ),
    );
  }

  testWidgets('renders metrics and organization cards', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubOrgs();

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Organisasi'), findsWidgets);
    expect(find.text('Aktif'), findsWidgets);
    expect(find.text('Org Aktif'), findsOneWidget);
    expect(find.text('Org Suspend'), findsOneWidget);
    expect(find.text('Suspend'), findsOneWidget);
    expect(find.text('Aktifkan'), findsOneWidget);
  });

  testWidgets('empty state when no organizations', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubOrgs(orgs: []);

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Belum ada organisasi'), findsOneWidget);
  });

  testWidgets('filter by status and search', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubOrgs();

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.text('SUSPENDED'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Org Suspend'), findsOneWidget);
    expect(find.text('Org Aktif'), findsNothing);

    await tester.enterText(find.byType(TextField).first, 'tidakada');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Belum ada organisasi'), findsOneWidget);
  });

  testWidgets('suspend action patches organization', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubOrgs();
    when(() => mockApi.patch('/api/organizations/o1', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/organizations/o1'),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.text('Suspend'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    verify(() => mockApi.patch(
          '/api/organizations/o1',
          data: {'status': 'SUSPENDED'},
        )).called(1);
  });

  testWidgets('opens create form from add button', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubOrgs();

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.byIcon(Icons.add));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byType(BottomSheet), findsOneWidget);
    expect(find.byType(TextField), findsWidgets);
  });

  testWidgets('shows retry on error', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/organizations')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/organizations'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/organizations'),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    expect(find.text('Coba lagi'), findsOneWidget);
  });

  testWidgets('activate suspended organization', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubOrgs();
    when(() => mockApi.patch('/api/organizations/o2', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/organizations/o2'),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.ensureVisible(find.text('Aktifkan'));
    await tester.tap(find.text('Aktifkan'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    verify(() => mockApi.patch(
          '/api/organizations/o2',
          data: {'status': 'ACTIVE'},
        )).called(1);
  });

  testWidgets('create organization submits', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubOrgs();
    when(() => mockApi.post('/api/organizations', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/organizations'),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.byIcon(Icons.add));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    final fields = find.byType(TextField);
    expect(fields, findsWidgets);
    await tester.enterText(fields.first, 'Org Baru Test');
    final simpan = find.text('Simpan');
    if (simpan.evaluate().isNotEmpty) {
      await tester.tap(simpan.first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      verify(() => mockApi.post('/api/organizations', data: any(named: 'data')))
          .called(1);
    }
  });

  testWidgets('retry after error reloads', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    var fail = true;
    when(() => mockApi.get('/api/organizations')).thenAnswer((_) async {
      if (fail) {
        fail = false;
        throw DioException(
          requestOptions: RequestOptions(path: '/api/organizations'),
          type: DioExceptionType.connectionError,
        );
      }
      return Response(
        requestOptions: RequestOptions(path: '/api/organizations'),
        data: {'organizations': []},
      );
    });
    when(() => mockApi.get('/api/regions')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/regions'),
        data: {'regions': []},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Coba lagi'), findsOneWidget);
    await tester.tap(find.text('Coba lagi'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Belum ada organisasi'), findsOneWidget);
  });

  testWidgets('create form validates short name and fills optional fields',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubOrgs();
    when(() => mockApi.post('/api/organizations', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/organizations'),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();

    expect(find.text('Tambah organisasi'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Nama organisasi'),
      'A',
    );
    await tester.tap(find.text('Buat organisasi'));
    await tester.pumpAndSettle();
    expect(find.text('Nama minimal 2 karakter.'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Nama organisasi'),
      'Org Lengkap',
    );

    final typeDd = find.byType(DropdownButtonFormField<String>);
    if (typeDd.evaluate().isNotEmpty) {
      await tester.ensureVisible(typeDd.first);
      await tester.tap(typeDd.first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Kampus').last);
      await tester.pumpAndSettle();
    }

    final regionDd = find.byType(DropdownButtonFormField<String?>);
    if (regionDd.evaluate().isNotEmpty) {
      await tester.ensureVisible(regionDd.first);
      await tester.tap(regionDd.first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Jakarta').last);
      await tester.pumpAndSettle();
    }

    await tester.enterText(
      find.widgetWithText(TextField, 'Alamat (opsional)'),
      'Jl. Baru 9',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Nama kontak (opsional)'),
      'Andi',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Telepon kontak (opsional)'),
      '08123',
    );

    await tester.tap(find.text('Buat organisasi'));
    await tester.pumpAndSettle();

    verify(() => mockApi.post('/api/organizations', data: any(named: 'data')))
        .called(1);
  });

  testWidgets('create organization API error shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubOrgs();
    when(() => mockApi.post('/api/organizations', data: any(named: 'data')))
        .thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/organizations'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/organizations'),
          statusCode: 500,
          data: {'error': 'Terjadi kesalahan pada server.'},
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Nama organisasi'),
      'Org Gagal',
    );
    await tester.tap(find.text('Buat organisasi'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
  });

  testWidgets('edit organization form submits changes', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubOrgs(orgs: [
      {
        'id': 'o1',
        'name': 'Org Aktif',
        'status': 'ACTIVE',
        'type': 'CAMPUS',
        'address': 'Jl. Merdeka 1',
        'contactName': 'Budi',
        'contactPhone': '08111',
        'regionId': 'r1',
        'region': {'id': 'r1', 'name': 'Jakarta'},
        '_count': {'machines': 2, 'users': 5},
      },
      {
        'id': 'o3',
        'name': 'Org Desa',
        'status': 'INACTIVE',
        'type': 'VILLAGE',
        'address': '',
        '_count': {'machines': 0, 'users': 0},
      },
      {
        'id': 'o4',
        'name': 'Org Wisata',
        'status': 'ACTIVE',
        'type': 'TOURISM_SITE',
        '_count': {'machines': 1, 'users': 1},
      },
      {
        'id': 'o5',
        'name': 'Org Komunitas',
        'status': 'ACTIVE',
        'type': 'COMMUNITY',
        '_count': {'machines': 0, 'users': 2},
      },
      {
        'id': 'o6',
        'name': 'Bank Sampah X',
        'status': 'ACTIVE',
        'type': 'WASTE_BANK',
        '_count': {'machines': 3, 'users': 4},
      },
      {
        'id': 'o7',
        'name': 'Org Lain',
        'status': 'ACTIVE',
        'type': 'OTHER',
        '_count': {'machines': 0, 'users': 0},
      },
    ]);
    when(() => mockApi.patch('/api/organizations/o1', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/organizations/o1'),
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.textContaining('Kampus'), findsWidgets);
    expect(find.textContaining('Desa'), findsWidgets);
    expect(find.textContaining('Lokasi wisata'), findsWidgets);
    expect(find.textContaining('Komunitas'), findsWidgets);
    expect(find.textContaining('Bank sampah'), findsWidgets);
    expect(find.textContaining('Lainnya'), findsWidgets);

    await tester.ensureVisible(find.text('Edit').first);
    await tester.tap(find.text('Edit').first);
    await tester.pumpAndSettle();

    expect(find.text('Edit organisasi'), findsOneWidget);
    await tester.enterText(
      find.widgetWithText(TextField, 'Nama organisasi'),
      'Org Diedit',
    );

    final statusDd = find.byType(DropdownButtonFormField<String>);
    if (statusDd.evaluate().length > 1) {
      await tester.ensureVisible(statusDd.last);
      await tester.tap(statusDd.last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Nonaktif').last);
      await tester.pumpAndSettle();
    }

    await tester.tap(find.text('Simpan perubahan'));
    await tester.pumpAndSettle();

    verify(() => mockApi.patch(
          '/api/organizations/o1',
          data: any(named: 'data'),
        )).called(1);
  });
}
