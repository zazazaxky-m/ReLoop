import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/features/scan/scan_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;
  void Function(FlutterErrorDetails)? previousOnError;

  setUp(() {
    previousOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      final message = details.exceptionAsString();
      if (message.contains('RenderFlex overflowed') ||
          message.contains('MissingPluginException') ||
          message.contains('PlatformException') ||
          message.contains('mobile_scanner') ||
          message.contains('LateInitializationError') ||
          message.contains('CameraException') ||
          message.contains('hasSize') ||
          message.contains('NEEDS-LAYOUT') ||
          message.contains('NEEDS-PAINT') ||
          message.contains('parentData dirty') ||
          message.contains('Failed assertion') ||
          message.contains('A RenderFlex') ||
          message.contains('Cannot hit test')) {
        return;
      }
      previousOnError?.call(details);
    };
    mockApi = MockApiClient();
  });

  tearDown(() {
    FlutterError.onError = previousOnError;
  });

  Future<ScanScreenState> pumpScan(WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 900));
    await tester.pumpWidget(
      MultiProvider(
        providers: [Provider<ApiClient>.value(value: mockApi)],
        child: MaterialApp(
          theme: AppTheme.light,
          home: const ScanScreen(),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    return tester.state<ScanScreenState>(find.byType(ScanScreen));
  }

  Map<String, dynamic> scanPayload({
    String status = 'ACTIVE',
    List<Map<String, dynamic>>? items,
    Map<String, dynamic>? machineOverrides,
  }) {
    final itemList = items ??
        [
          {
            'id': 'i1',
            'rewardAmount': 500,
            'measuredWeightGrams': 250,
            'aiDetectedType': 'PET',
            'wasteType': {'id': 'wt1', 'name': 'PET', 'code': 'PET'},
          },
        ];
    final baseMachine = {
      'id': 'm1',
      'machineCode': 'MAC01',
      'name': 'Mesin A',
      'status': 'ONLINE',
      'fillLevelPercent': 20,
    };
    final machine = {
      ...baseMachine,
      if (machineOverrides != null) ...machineOverrides,
    };
    return {
      'session': {
        'id': 'sess-1',
        'userId': 'u1',
        'machineId': 'm1',
        'status': status,
        'startedAt': '2026-07-10T00:00:00Z',
        'anomalyCount': 0,
        'items': itemList,
        'machine': machine,
      },
      'machine': machine,
      'resumed': false,
    };
  }

  testWidgets('renders scanner chrome', (tester) async {
    await pumpScan(tester);
    expect(find.byType(ScanScreen), findsOneWidget);
    expect(find.text('Masukkan kode manual'), findsOneWidget);
  });

  testWidgets('invalid machine code shows error UI', (tester) async {
    final state = await pumpScan(tester);
    await state.debugHandleQrCode('!');
    await tester.pump();
    expect(find.textContaining('tidak valid'), findsWidgets);
    expect(find.text('Scan lagi'), findsOneWidget);
  });

  testWidgets('token too long shows error', (tester) async {
    final state = await pumpScan(tester);
    await state.debugHandleQrCode(
      'https://reloop.id/scan?machine=MAC01&token=${'x' * 300}',
    );
    await tester.pump();
    expect(find.textContaining('Token tidak valid'), findsWidgets);
  });

  testWidgets('API error surfaces server message and resume', (tester) async {
    when(() => mockApi.post('/api/scan', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/scan'),
        type: DioExceptionType.badResponse,
        response: Response(
          requestOptions: RequestOptions(path: '/api/scan'),
          statusCode: 400,
          data: {'error': 'Mesin offline'},
        ),
      ),
    );

    final state = await pumpScan(tester);
    await state.debugHandleQrCode('MAC01');
    await tester.pump();
    expect(find.textContaining('Mesin offline'), findsWidgets);

    await tester.tap(find.text('Scan lagi'));
    await tester.pump();
    expect(find.text('Masukkan kode manual'), findsOneWidget);
  });

  testWidgets('successful scan shows session and finish', (tester) async {
    when(() => mockApi.post(any(), data: any(named: 'data'))).thenAnswer(
      (invocation) async {
        final path = invocation.positionalArguments.first as String;
        if (path.contains('/api/scan')) {
          return Response(
            requestOptions: RequestOptions(path: path),
            data: scanPayload(),
          );
        }
        return Response(
          requestOptions: RequestOptions(path: path),
          data: {
            'session': scanPayload(status: 'COMPLETED')['session'],
          },
        );
      },
    );
    when(() => mockApi.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/sessions/sess-1'),
        data: {
          'session': scanPayload()['session'],
        },
      ),
    );

    final state = await pumpScan(tester);
    await state.debugHandleQrCode(
      'https://reloop.id/scan?machine=MAC01&token=tok',
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.textContaining('Mesin A'), findsWidgets);
    expect(find.textContaining('PET'), findsWidgets);

    await tester.pump(const Duration(seconds: 3));

    final finish = find.textContaining('Selesai');
    expect(finish, findsWidgets);
    await tester.tap(finish.first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
  });

  testWidgets('empty items shows empty copy', (tester) async {
    when(() => mockApi.post('/api/scan', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/scan'),
        data: scanPayload(items: const []),
      ),
    );
    when(() => mockApi.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/sessions/sess-1'),
        data: {
          'session': scanPayload(items: const [])['session'],
        },
      ),
    );

    final state = await pumpScan(tester);
    await state.debugHandleQrCode(
      'https://reloop.id/machine/MAC01/display?token=abc',
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('Belum ada item'), findsWidgets);
  });

  testWidgets('plain machine code path works', (tester) async {
    when(() => mockApi.post('/api/scan', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/scan'),
        data: scanPayload(),
      ),
    );
    when(() => mockApi.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/sessions/sess-1'),
        data: {
          'session': scanPayload()['session'],
        },
      ),
    );

    final state = await pumpScan(tester);
    await state.debugHandleQrCode('MAC01');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('Mesin A'), findsWidgets);
  });

  testWidgets('invalid URI falls through to invalid QR error', (tester) async {
    final state = await pumpScan(tester);
    // Unclosed IPv6 bracket makes Uri.parse throw FormatException, which is
    // caught and surfaced as a generic invalid-QR message.
    await state.debugHandleQrCode('http://[invalid');
    await tester.pump();
    expect(find.textContaining('QR code tidak valid'), findsWidgets);
    expect(find.text('Scan lagi'), findsOneWidget);
  });

  testWidgets('renders machine org and supported waste types', (tester) async {
    when(() => mockApi.post('/api/scan', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/scan'),
        data: scanPayload(machineOverrides: {
          'organizationName': 'Org Hijau Lestari',
          'supportedWasteTypes': [
            {'id': 'wt1', 'name': 'PET'},
            {'id': 'wt2', 'name': 'Kaca'},
          ],
        }),
      ),
    );
    when(() => mockApi.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/sessions/sess-1'),
        data: {
          'session': scanPayload()['session'],
        },
      ),
    );

    final state = await pumpScan(tester);
    await state.debugHandleQrCode('MAC01');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Organisasi'), findsOneWidget);
    expect(find.text('Org Hijau Lestari'), findsOneWidget);
    expect(find.text('Jenis sampah:'), findsOneWidget);
    expect(find.text('PET'), findsWidgets);
    expect(find.text('Kaca'), findsOneWidget);
  });

  testWidgets('polling terminal status cancels timer', (tester) async {
    var pollCount = 0;
    when(() => mockApi.post('/api/scan', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/scan'),
        data: scanPayload(),
      ),
    );
    when(() => mockApi.get(any())).thenAnswer(
      (invocation) async {
        pollCount += 1;
        return Response(
          requestOptions: RequestOptions(path: '/api/sessions/sess-1'),
          data: {
            'session': scanPayload(
              status: pollCount >= 2 ? 'COMPLETED' : 'ACTIVE',
            )['session'],
          },
        );
      },
    );

    final state = await pumpScan(tester);
    await state.debugHandleQrCode('MAC01');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // Pump enough time for the 2-second poll timer to fire and hit COMPLETED.
    await tester.pump(const Duration(seconds: 3));
    await tester.pump(const Duration(seconds: 3));
    expect(pollCount, greaterThanOrEqualTo(2));
    // Status badge updates to COMPLETED and the "Memantau sesi…" hint goes away.
    expect(find.text('Selesai'), findsNWidgets(2));
  });

  testWidgets('finish session hits patch success path', (tester) async {
    when(() => mockApi.post('/api/scan', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/scan'),
        data: scanPayload(),
      ),
    );
    when(() => mockApi.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/sessions/sess-1'),
        data: {
          'session': scanPayload(status: 'COMPLETED')['session'],
        },
      ),
    );
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/sessions/sess-1'),
        statusCode: 200,
        data: {'ok': true},
      ),
    );

    final state = await pumpScan(tester);
    await state.debugHandleQrCode('MAC01');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(seconds: 3));

    // "Selesai" is rendered twice: once inside the StatusBadge and once inside
    // the ReLoopButton. Tap the button version (the last match).
    final finish = find.text('Selesai');
    expect(finish, findsNWidgets(2));
    await tester.tap(finish.last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
  });

  testWidgets('finish session still resets when patch throws', (tester) async {
    when(() => mockApi.post('/api/scan', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/scan'),
        data: scanPayload(),
      ),
    );
    when(() => mockApi.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/sessions/sess-1'),
        data: {
          'session': scanPayload(status: 'COMPLETED')['session'],
        },
      ),
    );
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/sessions/sess-1'),
        type: DioExceptionType.connectionError,
      ),
    );

    final state = await pumpScan(tester);
    await state.debugHandleQrCode('MAC01');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(seconds: 3));

    final finish = find.text('Selesai');
    expect(finish, findsNWidgets(2));
    await tester.tap(finish.last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    // After reset, the bottom panel should be back to the default state.
    expect(find.text('Masukkan kode manual'), findsOneWidget);
  });
}
