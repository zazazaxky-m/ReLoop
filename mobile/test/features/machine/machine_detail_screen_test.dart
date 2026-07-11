import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/features/machine/machine_detail_screen.dart';
import 'package:reloop_mobile/features/machine/machine_report_form.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
  });

  Widget buildScreen() {
    return Provider<ApiClient>.value(
      value: mockApi,
      child: const MaterialApp(
        home: MachineDetailScreen(machineCode: 'MAC-123'),
      ),
    );
  }

  testWidgets('renders full machine detail data', (tester) async {
    when(() => mockApi.get('/api/public/machines/MAC-123')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/machines/MAC-123'),
        data: {
          'machine': {
            'id': 'm1',
            'machineCode': 'MAC-123',
            'name': 'Mesin A',
            'organizationName': 'Org A',
            'status': 'ONLINE',
            'fillLevelPercent': 72,
            'latitude': -6.2088,
            'longitude': 106.8456,
            'supportedWasteTypes': [
              {'id': 'w1', 'name': 'Plastik'},
              {'id': 'w2', 'name': 'Kertas'},
            ],
          },
          'recentSessions': [
            {
              'id': 's1',
              'userId': 'u1',
              'machineId': 'm1',
              'status': 'COMPLETED',
              'startedAt': '2026-07-10T08:00:00Z',
            },
          ],
        },
      ),
    );

    await tester.pumpWidget(buildScreen());
    expect(find.byType(Scaffold), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);

    await tester.pumpAndSettle();

    expect(find.text('Mesin A'), findsWidgets);
    await tester.scrollUntilVisible(
      find.text('Laporkan Masalah', skipOffstage: false),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Plastik', skipOffstage: false), findsOneWidget);
    expect(find.text('Kertas', skipOffstage: false), findsOneWidget);
    expect(find.textContaining('10/7/2026 8:00'), findsOneWidget);
    expect(find.text('Laporkan Masalah', skipOffstage: false), findsOneWidget);
  });

  testWidgets('hides optional sections when data is minimal', (tester) async {
    when(() => mockApi.get('/api/public/machines/MAC-123')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/machines/MAC-123'),
        data: {
          'machine': {
            'id': 'm1',
            'machineCode': 'MAC-123',
            'name': 'Mesin Minimal',
            'status': 'OFFLINE',
            'fillLevelPercent': 0,
          },
          'recentSessions': [],
        },
      ),
    );

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.text('Mesin Minimal'), findsWidgets);
    expect(find.text('Jenis Sampah Didukung'), findsNothing);
    expect(find.text('Sesi Terakhir'), findsNothing);
    expect(find.text('Kapasitas: 0%'), findsNothing);
  });

  testWidgets('shows retry state on error', (tester) async {
    when(() => mockApi.get('/api/public/machines/MAC-123')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/public/machines/MAC-123'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/public/machines/MAC-123'),
          statusCode: 404,
          data: {'error': 'Data tidak ditemukan.'},
        ),
        type: DioExceptionType.badResponse,
      ),
    );

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.text('Data tidak ditemukan.'), findsOneWidget);
    expect(find.text('Coba Lagi'), findsOneWidget);
  });

  testWidgets('tapping report opens MachineReportForm', (tester) async {
    when(() => mockApi.get('/api/public/machines/MAC-123')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/public/machines/MAC-123'),
        data: {
          'machine': {
            'id': 'm1',
            'machineCode': 'MAC-123',
            'name': 'Mesin A',
            'status': 'ONLINE',
            'fillLevelPercent': 10,
          },
          'recentSessions': [],
        },
      ),
    );

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Laporkan Masalah', skipOffstage: false),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Laporkan Masalah'));
    await tester.pumpAndSettle();

    expect(find.byType(MachineReportForm), findsOneWidget);
  });
}
