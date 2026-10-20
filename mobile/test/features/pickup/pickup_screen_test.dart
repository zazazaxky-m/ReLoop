import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/pickup/pickup_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}
class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockApiClient mockApi;
  late MockAuthProvider mockAuth;

  setUp(() {
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'p1',
        name: 'Pengepul',
        email: 'pengepul@reloop.id',
        role: AppRole.PENGEPUL,
        status: 'ACTIVE',
      ),
    );
  });

  Map<String, dynamic> pickup({
    required String id,
    required String status,
    int priority = 0,
    List<dynamic>? items,
  }) =>
      {
        'id': id,
        'status': status,
        'reason': 'FULL',
        'priority': priority,
        'machineId': 'm1',
        'machine': {
          'name': 'Mesin $id',
          'machineCode': 'MAC-$id',
          'fillLevelPercent': 95,
        },
        'organization': {
          'name': 'Mitra A',
          'contactName': 'Andi',
          'contactPhone': '0812',
          'address': 'Jl. Merdeka 1',
        },
        '_count': {'items': items?.length ?? 0},
        'items': items ?? [],
      };

  void stubCollectorApis({
    List<Map<String, dynamic>>? pickups,
  }) {
    when(() => mockApi.get('/api/pickups', queryParameters: {'scope': 'collector'}))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups'),
        data: {
          'pickups': pickups ??
              [
                pickup(id: 'pk1', status: 'ASSIGNED', priority: 1),
                pickup(
                  id: 'pk2',
                  status: 'ARRIVED',
                  items: [
                    {
                      'wasteType': {'name': 'Plastik'},
                      'itemCount': 10,
                      'actualWeightKg': 2.5,
                    },
                  ],
                ),
                pickup(id: 'pk3', status: 'COMPLETED'),
              ],
        },
      ),
    );
    when(() => mockApi.get('/api/waste-types')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/waste-types'),
        data: {
          'wasteTypes': [
            {'id': 'wt1', 'name': 'Plastik'},
            {'id': 'wt2', 'name': 'Kertas'},
          ],
        },
      ),
    );
    // B05: no `scope: available` stub; the screen must never ask for a claim pool.
  }

  Widget buildApp() {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const PickupScreen(),
      ),
    );
  }

  testWidgets('loads active tasks for collector', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Tugas Aktif'), findsOneWidget);
    expect(find.text('Mesin pk1'), findsOneWidget);
    expect(find.text('Mulai Perjalanan'), findsOneWidget);
    expect(find.text('P1'), findsOneWidget);
  });

  testWidgets('admin dispatch: no self-claim tab, empty state waits for admin', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(pickups: []);

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Menunggu penugasan admin'), findsOneWidget);
    expect(find.textContaining('Admin organisasi mitra menugaskan'), findsOneWidget);
    expect(find.text('Tersedia'), findsNothing);
    expect(find.text('Ambil Tugas Ini'), findsNothing);
    verifyNever(() => mockApi.get('/api/pickups', queryParameters: {'scope': 'available'}));
  });

  testWidgets('field steps carry the loaded version and show the admin deadline', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(pickups: [
      {
        ...pickup(id: 'pk1', status: 'ASSIGNED'),
        'version': 4,
        'assignedAt': '2026-10-14T01:00:00.000Z',
        'expectedStartAt': '2026-10-14T03:00:00.000Z',
        'dispatch': {'nextLabel': 'Menunggu pengepul berangkat', 'overdue': false},
      },
    ]);
    when(() => mockApi.patch('/api/pickups/pk1', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk1'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Langkah berikutnya: Menunggu pengepul berangkat'), findsOneWidget);
    expect(find.textContaining('Tenggat mulai:'), findsOneWidget);
    expect(find.textContaining('Ditugaskan admin'), findsOneWidget);

    await tester.tap(find.text('Mulai Perjalanan'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/pickups/pk1', data: {'action': 'start', 'expectedVersion': 4})).called(1);
  });

  testWidgets('starts assigned pickup and confirms fail cancel', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis();
    when(() => mockApi.patch('/api/pickups/pk1', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk1'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Mulai Perjalanan'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/pickups/pk1', data: {'action': 'start'})).called(1);

    // Fail dialog cancel path on arrived task
    await tester.tap(find.text('Gagal').first);
    await tester.pumpAndSettle();
    expect(find.text('Gagalkan Pickup?'), findsOneWidget);
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
  });

  testWidgets('records material from arrived pickup', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubCollectorApis();
    when(() => mockApi.post('/api/pickups/pk2/items', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk2/items'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.textContaining('Material tercatat'), findsOneWidget);

    await tester.ensureVisible(find.text('Catat Material'));
    await tester.tap(find.text('Catat Material'));
    await tester.pumpAndSettle();

    expect(find.text('Simpan Material'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextFormField, 'Jumlah (pcs)'), '5');
    await tester.enterText(find.widgetWithText(TextFormField, 'Berat aktual (kg)'), '1.2');
    await tester.tap(find.text('Simpan Material'));
    await tester.pumpAndSettle();

    expect(find.text('Material berhasil dicatat'), findsOneWidget);
  });

  testWidgets('shows completed tab', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    stubCollectorApis();

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Selesai/Gagal'));
    await tester.pumpAndSettle();
    expect(find.text('Mesin pk3'), findsOneWidget);
  });

  testWidgets('shows error and retry', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.get('/api/pickups', queryParameters: {'scope': 'collector'}))
        .thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/pickups'),
        type: DioExceptionType.connectionError,
      ),
    );
    when(() => mockApi.get('/api/waste-types')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/waste-types'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Coba Lagi'), findsOneWidget);

    stubCollectorApis();
    await tester.tap(find.text('Coba Lagi'));
    await tester.pumpAndSettle();
    expect(find.text('Tugas Aktif'), findsOneWidget);
  });

  testWidgets('ON_THE_WAY arrive action', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(
      pickups: [pickup(id: 'pk4', status: 'ON_THE_WAY')],
    );
    when(() => mockApi.patch('/api/pickups/pk4', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk4'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Tiba'), findsOneWidget);
    await tester.tap(find.text('Tiba'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/pickups/pk4', data: {'action': 'arrive'}))
        .called(1);
  });

  testWidgets('ARRIVED collect action', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(
      pickups: [pickup(id: 'pk5', status: 'ARRIVED')],
    );
    when(() => mockApi.patch('/api/pickups/pk5', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk5'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Ambil Sampah'), findsOneWidget);
    await tester.tap(find.text('Ambil Sampah'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/pickups/pk5', data: {'action': 'collect'}))
        .called(1);
  });

  testWidgets('COLLECTED complete action', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(
      pickups: [pickup(id: 'pk6', status: 'COLLECTED')],
    );
    when(() => mockApi.patch('/api/pickups/pk6', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk6'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Selesai'), findsOneWidget);
    await tester.tap(find.text('Selesai'));
    await tester.pumpAndSettle();
    verify(
      () => mockApi.patch('/api/pickups/pk6', data: {'action': 'complete'}),
    ).called(1);
  });

  testWidgets('confirm fail pickup', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(
      pickups: [pickup(id: 'pk1', status: 'ASSIGNED')],
    );
    when(() => mockApi.patch('/api/pickups/pk1', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk1'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Gagal'));
    await tester.pumpAndSettle();
    expect(find.text('Gagalkan Pickup?'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Alasan gagal'), 'Mobil mogok');
    await tester.tap(find.text('Ya, Gagalkan'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/pickups/pk1', data: {'action': 'fail', 'reason': 'Mobil mogok'}))
        .called(1);
  });

  testWidgets('fail without a reason is not sent', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(
      pickups: [pickup(id: 'pk1', status: 'ASSIGNED')],
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Gagal'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ya, Gagalkan'));
    await tester.pumpAndSettle();
    expect(find.text('Alasan wajib diisi (3-500 karakter)'), findsOneWidget);
    verifyNever(() => mockApi.patch(any(), data: any(named: 'data')));
  });

  testWidgets('reason labels and empty tabs', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(
      pickups: [
        {
          ...pickup(id: 'pk7', status: 'ASSIGNED'),
          'reason': 'SCHEDULED',
        },
        {
          ...pickup(id: 'pk8', status: 'FAILED'),
          'reason': 'ERROR',
        },
        {
          ...pickup(id: 'pk9', status: 'COMPLETED'),
          'reason': 'MANUAL',
        },
      ],
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Terjadwal'), findsOneWidget);

    await tester.tap(find.text('Selesai/Gagal'));
    await tester.pumpAndSettle();
    expect(find.text('Error'), findsWidgets);
    expect(find.text('Manual'), findsWidgets);
  });

  testWidgets('material form waste type and close', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubCollectorApis(
      pickups: [pickup(id: 'pk2', status: 'ARRIVED')],
    );
    when(() => mockApi.post('/api/pickups/pk2/items', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk2/items'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Catat Material'));
    await tester.tap(find.text('Catat Material'));
    await tester.pumpAndSettle();

    final wasteDropdown = find.text('Pilih jenis...');
    if (wasteDropdown.evaluate().isNotEmpty) {
      await tester.tap(wasteDropdown);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Kertas').last);
      await tester.pumpAndSettle();
    }

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Jumlah (pcs)'),
      '3',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Berat aktual (kg)'),
      '0.8',
    );
    await tester.tap(find.text('Simpan Material'));
    await tester.pumpAndSettle();
    expect(find.text('Material berhasil dicatat'), findsOneWidget);

    await tester.ensureVisible(find.text('Catat Material'));
    await tester.tap(find.text('Catat Material'));
    await tester.pumpAndSettle();
    final closeForm = find.text('Tutup Form Material');
    if (closeForm.evaluate().isNotEmpty) {
      await tester.tap(closeForm);
      await tester.pumpAndSettle();
    }
  });

  testWidgets('never requests a self-claim pool (non-pengepul)', (tester) async {
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: 'User',
        email: 'u@reloop.id',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );
    when(() => mockApi.get('/api/pickups', queryParameters: {'scope': 'collector'}))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups'),
        data: {'pickups': []},
      ),
    );
    when(() => mockApi.get('/api/waste-types')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/waste-types'),
        data: {'wasteTypes': []},
      ),
    );

    await tester.binding.setSurfaceSize(const Size(800, 1200));
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    verifyNever(
      () => mockApi.get('/api/pickups', queryParameters: {'scope': 'available'}),
    );
  });

  testWidgets('Gagal for ON_THE_WAY shows confirm dialog', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(
      pickups: [pickup(id: 'pk1', status: 'ON_THE_WAY')],
    );
    when(() => mockApi.patch('/api/pickups/pk1', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk1'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Gagal'));
    await tester.pumpAndSettle();
    expect(find.text('Gagalkan Pickup?'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Alasan gagal'), 'Akses ditutup');
    await tester.tap(find.text('Ya, Gagalkan'));
    await tester.pumpAndSettle();
    verify(() => mockApi.patch('/api/pickups/pk1', data: {'action': 'fail', 'reason': 'Akses ditutup'}))
        .called(1);
  });

  testWidgets('Gagal for ARRIVED shows confirm dialog', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(
      pickups: [pickup(id: 'pk1', status: 'ARRIVED')],
    );
    when(() => mockApi.patch('/api/pickups/pk1', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk1'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Gagal'));
    await tester.pumpAndSettle();
    expect(find.text('Gagalkan Pickup?'), findsOneWidget);
  });

  testWidgets('Gagal for COLLECTED shows confirm dialog', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(
      pickups: [pickup(id: 'pk1', status: 'COLLECTED')],
    );
    when(() => mockApi.patch('/api/pickups/pk1', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk1'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Gagal'));
    await tester.pumpAndSettle();
    expect(find.text('Gagalkan Pickup?'), findsOneWidget);
  });

  testWidgets('updatePickupStatus error path shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1800));
    stubCollectorApis(
      pickups: [pickup(id: 'pk1', status: 'ASSIGNED')],
    );
    when(() => mockApi.patch('/api/pickups/pk1', data: any(named: 'data')))
        .thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/pickups/pk1'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Gagal'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Alasan gagal'), 'Mobil mogok');
    await tester.tap(find.text('Ya, Gagalkan'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Tidak dapat terhubung ke server'),
      findsWidgets,
    );
  });

  testWidgets('recordMaterial error path shows snackbar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubCollectorApis(
      pickups: [pickup(id: 'pk2', status: 'ARRIVED')],
    );
    when(() => mockApi.post('/api/pickups/pk2/items', data: any(named: 'data')))
        .thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/pickups/pk2/items'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Catat Material'));
    await tester.tap(find.text('Catat Material'));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Jumlah (pcs)'),
      '3',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Berat aktual (kg)'),
      '1.0',
    );
    await tester.tap(find.text('Simpan Material'));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Gagal mencatat material'),
      findsWidgets,
    );
  });

  testWidgets('material form notes onChanged updates state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubCollectorApis(
      pickups: [pickup(id: 'pk2', status: 'ARRIVED')],
    );
    when(() => mockApi.post('/api/pickups/pk2/items', data: any(named: 'data')))
        .thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/pickups/pk2/items'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Catat Material'));
    await tester.tap(find.text('Catat Material'));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Catatan'),
      'Sampah basah',
    );
    await tester.pump();
    expect(find.text('Sampah basah'), findsOneWidget);
  });

  testWidgets('material form close button toggles form', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    stubCollectorApis(
      pickups: [pickup(id: 'pk2', status: 'ARRIVED')],
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Catat Material'));
    await tester.tap(find.text('Catat Material'));
    await tester.pumpAndSettle();
    expect(find.text('Simpan Material'), findsOneWidget);

    await tester.ensureVisible(find.text('Batal'));
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    // After closing the form the Simpan button should no longer be visible.
    expect(find.text('Simpan Material'), findsNothing);
  });
}
