import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/features/pickup/tourism_pickups_screen.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockApi;

  setUp(() {
    mockApi = MockApiClient();
  });

  Widget buildApp() {
    return Provider<ApiClient>.value(
      value: mockApi,
      child: MaterialApp(
        theme: AppTheme.light,
        home: const TourismPickupsScreen(),
      ),
    );
  }

  List<Map<String, dynamic>> tripsJson() => [
        {
          'id': 'trip1',
          'groupName': 'Grup Nusantara',
          'campaignName': 'Wisata Hijau',
          'organizationName': 'Bank Sampah A',
          'travelAgentName': 'Travel X',
          'bagCount': 8,
          'complianceStatus': 'GOOD',
          'complianceScore': 92,
          'pickedUp': false,
        },
        {
          'id': 'trip2',
          'groupName': 'Grup Selesai',
          'campaignName': 'Wisata Hijau',
          'organizationName': 'Bank Sampah A',
          'travelAgentName': null,
          'bagCount': 4,
          'complianceStatus': 'GOOD',
          'complianceScore': 80,
          'pickedUp': true,
        },
      ];

  testWidgets('loads tourism pickup list', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/tourism-pickups')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/tourism-pickups'),
        data: {'trips': tripsJson()},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Pickup Wisata'), findsOneWidget);
    expect(find.text('Grup Nusantara'), findsOneWidget);
    expect(find.text('Catat Pickup'), findsOneWidget);
    expect(find.text('Sudah dijemput'), findsOneWidget);
    expect(find.textContaining('Tas: 8'), findsOneWidget);
  });

  testWidgets('records pickup successfully', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/tourism-pickups')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/tourism-pickups'),
        data: {'trips': tripsJson()},
      ),
    );
    when(() => mockApi.post('/api/manual-validations', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/manual-validations'),
        data: {'ok': true},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Catat Pickup'));
    await tester.pumpAndSettle();

    expect(find.text('Pickup wisata berhasil dicatat'), findsOneWidget);
    verify(() => mockApi.post('/api/manual-validations', data: any(named: 'data'))).called(1);
  });

  testWidgets('shows snackbar on record failure', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    when(() => mockApi.get('/api/mobile/tourism-pickups')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/tourism-pickups'),
        data: {'trips': tripsJson()},
      ),
    );
    when(() => mockApi.post('/api/manual-validations', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/manual-validations'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Catat Pickup'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Tidak dapat terhubung ke server'), findsOneWidget);
  });

  testWidgets('shows empty state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.get('/api/mobile/tourism-pickups')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/tourism-pickups'),
        data: {'trips': []},
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.textContaining('Belum ada pickup wisata'), findsOneWidget);
  });

  testWidgets('shows error and retry', (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    when(() => mockApi.get('/api/mobile/tourism-pickups')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/mobile/tourism-pickups'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Coba Lagi'), findsOneWidget);

    when(() => mockApi.get('/api/mobile/tourism-pickups')).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/mobile/tourism-pickups'),
        data: {'trips': []},
      ),
    );
    await tester.tap(find.text('Coba Lagi'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Belum ada pickup wisata'), findsOneWidget);
  });
}
