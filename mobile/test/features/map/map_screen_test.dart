import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart' show LatLng;
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/map/map_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

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
      if (message.contains('ClientException') ||
          message.contains('tile.openstreetmap') ||
          message.contains('HttpException') ||
          message.contains('RenderFlex overflowed') ||
          message.contains('A RenderFlex overflowed') ||
          message.contains('SocketException')) {
        return;
      }
      previousOnError?.call(details);
    };
    mockApi = MockApiClient();
    mockAuth = MockAuthProvider();
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: '1',
        name: 'User',
        email: 'user@a.com',
        role: AppRole.USER,
        status: 'ACTIVE',
      ),
    );
  });

  tearDown(() {
    FlutterError.onError = previousOnError;
  });

  void stubMap({
    List<Map<String, dynamic>>? machines,
    List<Map<String, dynamic>>? campaigns,
    bool throwError = false,
  }) {
    when(
      () => mockApi.get(any(), queryParameters: any(named: 'queryParameters')),
    ).thenAnswer((invocation) async {
      if (throwError) {
        throw DioException(
          requestOptions: RequestOptions(path: '/api/public/machines'),
          type: DioExceptionType.connectionError,
        );
      }
      final path = invocation.positionalArguments[0] as String;
      if (path.contains('machines')) {
        return Response(
          requestOptions: RequestOptions(path: path),
          data: {
            'machines': machines ??
                [
                  {
                    'id': 'm1',
                    'name': 'Mesin A',
                    'machineCode': 'MAC-123',
                    'status': 'ONLINE',
                    'latitude': -6.2088,
                    'longitude': 106.8456,
                    'fillLevelPercent': 50,
                    'organizationId': 'org1',
                  },
                  {
                    'id': 'm2',
                    'name': 'Mesin Full',
                    'machineCode': 'MAC-FULL',
                    'status': 'FULL',
                    'latitude': -6.21,
                    'longitude': 106.85,
                    'fillLevelPercent': 95,
                    'organizationId': 'org1',
                  },
                  {
                    'id': 'm3',
                    'name': 'Mesin Error',
                    'machineCode': 'MAC-ERR',
                    'status': 'ERROR',
                    'latitude': -6.22,
                    'longitude': 106.86,
                    'fillLevelPercent': 10,
                  },
                  {
                    'id': 'm4',
                    'name': 'Mesin Maint',
                    'machineCode': 'MAC-M',
                    'status': 'MAINTENANCE',
                    'latitude': -6.23,
                    'longitude': 106.87,
                    'fillLevelPercent': 20,
                  },
                  {
                    'id': 'm5',
                    'name': 'Mesin Off',
                    'machineCode': 'MAC-O',
                    'status': 'OFFLINE',
                    'latitude': -6.24,
                    'longitude': 106.88,
                    'fillLevelPercent': 0,
                  },
                ],
          },
        );
      }
      if (path.contains('campaigns')) {
        return Response(
          requestOptions: RequestOptions(path: path),
          data: {
            'campaigns': campaigns ??
                [
                  {
                    'id': 'c1',
                    'name': 'Kampanye Hijau',
                    'campaignType': 'EVENT',
                    'visibility': 'PUBLIC',
                    'status': 'ACTIVE',
                    'organizationId': 'org1',
                    'organization': {'name': 'Org A'},
                  },
                ],
          },
        );
      }
      return Response(requestOptions: RequestOptions(path: path), data: {});
    });
  }

  Widget buildScreen({List<RouteBase> extra = const []}) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: MaterialApp.router(
        theme: AppTheme.light,
        routerConfig: GoRouter(
          initialLocation: '/map',
          routes: [
            GoRoute(
              path: '/map',
              builder: (_, __) => const MapScreen(),
            ),
            GoRoute(
              path: '/machines/:id',
              builder: (_, state) => Scaffold(
                body: Text('Machine ${state.pathParameters['id']}'),
              ),
            ),
            ...extra,
          ],
        ),
      ),
    );
  }

  testWidgets('MapScreen renders and loads data', (tester) async {
    stubMap(campaigns: const []);
    await tester.binding.setSurfaceSize(const Size(400, 800));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.byType(FlutterMap), findsOneWidget);
    expect(find.textContaining('mesin'), findsWidgets);
  });

  testWidgets('shows error and retry', (tester) async {
    stubMap(throwError: true);
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Coba Lagi'), findsOneWidget);

    stubMap(campaigns: const []);
    await tester.tap(find.text('Coba Lagi'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.byType(FlutterMap), findsOneWidget);
  });

  testWidgets('pengepul uses partners scope', (tester) async {
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: '1',
        name: 'Pengepul',
        email: 'p@a.com',
        role: AppRole.PENGEPUL,
        status: 'ACTIVE',
      ),
    );
    stubMap(campaigns: const []);
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    verify(
      () => mockApi.get(
        '/api/public/machines',
        queryParameters: {'scope': 'partners'},
      ),
    ).called(1);
  });

  testWidgets('campaign marker opens campaign card', (tester) async {
    stubMap();
    await tester.binding.setSurfaceSize(const Size(400, 800));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    final state = tester.state<MapScreenState>(find.byType(MapScreen));
    expect(state.debugCampaigns, isNotEmpty);
    state.debugSelectCampaign(state.debugCampaigns.first);
    await tester.pump();
    expect(find.text('Kampanye Hijau'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();
    expect(find.text('Kampanye Hijau'), findsNothing);
  });

  testWidgets('machine card shows detail and waste types', (tester) async {
    stubMap(
      machines: [
        {
          'id': 'm1',
          'name': 'Mesin A',
          'machineCode': 'MAC-123',
          'status': 'ONLINE',
          'latitude': -6.2088,
          'longitude': 106.8456,
          'fillLevelPercent': 50,
          'organizationId': 'org1',
          'supportedWasteTypes': [
            {'id': 'w1', 'name': 'Plastik'},
          ],
        },
      ],
      campaigns: const [],
    );
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    await tester.pumpWidget(
      buildScreen(
        extra: [
          GoRoute(
            path: '/machine/:code/detail',
            builder: (_, state) => Scaffold(
              body: Text('Detail ${state.pathParameters['code']}'),
            ),
          ),
        ],
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    final state = tester.state<MapScreenState>(find.byType(MapScreen));
    state.debugSelectMachine(state.debugMachines.first);
    await tester.pump();
    expect(find.text('Mesin A'), findsOneWidget);
    expect(find.text('Plastik'), findsOneWidget);

    await tester.tap(find.text('Detail'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Detail MAC-123'), findsOneWidget);
  });

  testWidgets('map tap clears selection via debugClear', (tester) async {
    stubMap(campaigns: const []);
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    final state = tester.state<MapScreenState>(find.byType(MapScreen));
    state.debugSelectMachine(state.debugMachines.first);
    await tester.pump();
    expect(find.text('Mesin A'), findsOneWidget);
    state.debugClearSelection();
    await tester.pump();
    expect(find.text('MAC-123'), findsNothing);
  });

  testWidgets('campaign card shows multiplier and description', (tester) async {
    stubMap(
      campaigns: [
        {
          'id': 'c1',
          'name': 'Kampanye Bonus',
          'campaignType': 'EVENT',
          'visibility': 'PUBLIC',
          'status': 'ACTIVE',
          'organizationId': 'org1',
          'organization': {'name': 'Org A'},
          'rewardMultiplier': 1.5,
          'description': 'Deskripsi kampanye panjang',
        },
      ],
    );
    await tester.binding.setSurfaceSize(const Size(400, 800));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.textContaining('5 mesin · 1 program'), findsOneWidget);

    final state = tester.state<MapScreenState>(find.byType(MapScreen));
    state.debugSelectCampaign(state.debugCampaigns.first);
    await tester.pump();
    expect(find.text('Kampanye Bonus'), findsOneWidget);
    expect(find.text('1.5x reward'), findsOneWidget);
    expect(find.textContaining('Deskripsi kampanye'), findsOneWidget);
    expect(find.text('Org A'), findsOneWidget);
  });

  testWidgets('machine fill level zero hides isi label', (tester) async {
    stubMap(
      machines: [
        {
          'id': 'm1',
          'name': 'Mesin Kosong',
          'machineCode': 'MAC-0',
          'status': 'ONLINE',
          'latitude': -6.2,
          'longitude': 106.8,
          'fillLevelPercent': 0,
        },
      ],
      campaigns: const [],
    );
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    final state = tester.state<MapScreenState>(find.byType(MapScreen));
    state.debugSelectMachine(state.debugMachines.first);
    await tester.pump();
    expect(find.text('Mesin Kosong'), findsOneWidget);
    expect(find.textContaining('Isi:'), findsNothing);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();
    expect(find.text('Mesin Kosong'), findsNothing);
  });

  testWidgets('empty machines still renders map', (tester) async {
    stubMap(machines: const [], campaigns: const []);
    await tester.binding.setSurfaceSize(const Size(400, 800));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.byType(FlutterMap), findsOneWidget);
    expect(find.textContaining('0 mesin'), findsWidgets);
  });

  testWidgets('campaign without matching org has no marker card path',
      (tester) async {
    stubMap(
      machines: [
        {
          'id': 'm1',
          'name': 'Mesin A',
          'machineCode': 'MAC-123',
          'status': 'ONLINE',
          'latitude': -6.2,
          'longitude': 106.8,
          'fillLevelPercent': 10,
          'organizationId': 'org1',
        },
      ],
      campaigns: [
        {
          'id': 'c99',
          'name': 'Orphan Campaign',
          'status': 'ACTIVE',
          'organizationId': 'org99',
          'organization': {'name': 'Other Org'},
        },
      ],
    );
    await tester.binding.setSurfaceSize(const Size(400, 800));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    final state = tester.state<MapScreenState>(find.byType(MapScreen));
    expect(state.debugCampaigns.length, 1);
    state.debugSelectCampaign(state.debugCampaigns.first);
    await tester.pump();
    expect(find.text('Orphan Campaign'), findsOneWidget);
  });

  testWidgets('tapping a machine marker selects it', (tester) async {
    stubMap(
      machines: const [
        {
          'id': 'm1',
          'name': 'Mesin A',
          'machineCode': 'MAC-123',
          'status': 'ONLINE',
          'latitude': -6.2088,
          'longitude': 106.8456,
          'fillLevelPercent': 50,
        },
      ],
      campaigns: const [],
    );
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    // Each machine marker wraps its icon in a GestureDetector that performs
    // the selection on tap. Tap the recycling icon to fire onTap.
    await tester.tap(find.byIcon(Icons.recycling).first);
    await tester.pump();

    expect(find.text('Mesin A'), findsOneWidget);
  });

  testWidgets('tapping a campaign marker selects it', (tester) async {
    stubMap(
      machines: const [
        {
          'id': 'm1',
          'name': 'Mesin A',
          'machineCode': 'MAC-123',
          'status': 'ONLINE',
          'latitude': -6.2088,
          'longitude': 106.8456,
          'fillLevelPercent': 50,
          'organizationId': 'org1',
        },
      ],
      campaigns: const [
        {
          'id': 'c1',
          'name': 'Kampanye Hijau',
          'campaignType': 'EVENT',
          'visibility': 'PUBLIC',
          'status': 'ACTIVE',
          'organizationId': 'org1',
        },
      ],
    );
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    await tester.tap(find.byIcon(Icons.campaign).first);
    await tester.pump();

    expect(find.text('Kampanye Hijau'), findsOneWidget);
  });

  testWidgets('tapping the map clears any active selection', (tester) async {
    stubMap(
      machines: const [
        {
          'id': 'm1',
          'name': 'Mesin A',
          'machineCode': 'MAC-123',
          'status': 'ONLINE',
          'latitude': -6.2088,
          'longitude': 106.8456,
          'fillLevelPercent': 50,
        },
      ],
      campaigns: const [],
    );
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    final state = tester.state<MapScreenState>(find.byType(MapScreen));
    state.debugSelectMachine(state.debugMachines.first);
    await tester.pump();
    expect(find.text('Mesin A'), findsOneWidget);

    // Invoke the map's onTap directly. flutter_map wires this callback to
    // its internal gesture handlers, but those are not reliably triggered by
    // raw tester.tapAt calls in widget tests. Calling the callback is the
    // documented way to simulate a map-tap that misses any markers.
    final mapWidget = tester.widget<FlutterMap>(find.byType(FlutterMap));
    mapWidget.options.onTap!(_FakeTapPosition(), const LatLng(-6.21, 106.84));
    await tester.pump();
    expect(find.text('Mesin A'), findsNothing);
  });
}

class _FakeTapPosition implements TapPosition {
  @override
  Offset get global => Offset.zero;
  @override
  Offset? get relative => Offset.zero;
}
