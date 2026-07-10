import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/features/admin/admin_machine_detail_screen.dart';

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
        home: AdminMachineDetailScreen(machineId: 'm1'),
      ),
    );
  }

  testWidgets('renders machine detail with sessions', (tester) async {
    when(() => mockApi.get('/api/machines/m1')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/machines/m1'),
        data: {
          'machine': {
            'id': 'm1',
            'name': 'Mesin A',
            'machineCode': 'MAC-123',
            'status': 'FULL',
            'fillLevelPercent': 90,
            'hasInputChamber': true,
            'hasConveyor': false,
            'hasCompactor': true,
            'hasExternalCamera': true,
            'capacityKg': 120,
            'chamberTimeoutSeconds': 30,
            'sessionIdleTimeoutMinutes': 10,
            'qrRotationSeconds': 60,
            'latitude': -6.2,
            'longitude': 106.8,
            'region': {'name': 'Jakarta'},
            'organization': {'name': 'Org A'},
            'wasteTypes': [
              {'wasteType': {'name': 'Plastik'}},
            ],
            'sessions': [
              {
                'startedAt': '2026-07-10T08:15:00Z',
                'status': 'ACTIVE',
              },
            ],
          },
        },
      ),
    );

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.text('Mesin A'), findsWidgets);
    expect(find.text('Kapasitas Terisi: 90%'), findsOneWidget);
    expect(find.text('Konfigurasi Hardware'), findsOneWidget);
    expect(find.text('Spesifikasi & Aturan'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Sesi Deposit Terakhir', skipOffstage: false),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Jenis Sampah Diterima', skipOffstage: false), findsOneWidget);
    expect(find.text('Sesi Deposit Terakhir', skipOffstage: false), findsOneWidget);
    expect(find.text('Plastik', skipOffstage: false), findsOneWidget);
    expect(find.text('Coba Lagi'), findsNothing);
  });

  testWidgets('shows empty session state when there is no history', (tester) async {
    when(() => mockApi.get('/api/machines/m1')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/machines/m1'),
        data: {
          'machine': {
            'id': 'm1',
            'name': 'Mesin B',
            'machineCode': 'MAC-456',
            'status': 'ONLINE',
            'fillLevelPercent': 0,
            'sessions': [],
          },
        },
      ),
    );

    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.text('Mesin B'), findsWidgets);
    await tester.scrollUntilVisible(
      find.text('Belum ada sesi di mesin ini', skipOffstage: false),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Belum ada sesi di mesin ini', skipOffstage: false), findsOneWidget);
    expect(find.text('Jenis Sampah Diterima', skipOffstage: false), findsNothing);
  });

  testWidgets('shows retry state on error', (tester) async {
    when(() => mockApi.get('/api/machines/m1')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/machines/m1'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/machines/m1'),
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
}
