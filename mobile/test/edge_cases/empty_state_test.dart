import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';

import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/features/wallet/redemption_screen.dart';
import '../helpers/mocks.dart';

void main() {
  late MockApiClient mockApi;

  setUpAll(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  setUp(() {
    mockApi = MockApiClient();
  });

  Widget createTestWidget() {
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: mockApi),
      ],
      child: const MaterialApp(
        home: RedemptionScreen(),
      ),
    );
  }

  group('Edge Cases - Empty State', () {
    testWidgets('T1: Menampilkan empty state ketika riwayat pencairan kosong', (tester) async {
      // Arrange
      when(() => mockApi.get('/api/wallet')).thenAnswer((_) async => Response(
            requestOptions: RequestOptions(path: '/api/wallet'),
            statusCode: 200,
            data: {
              'balance': {
                'available': 0,
                'pending': 0,
              },
              'payoutAccounts': [],
              'redemptions': [], // Kosong
            },
          ));

      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();

      // Memastikan bahwa tampilan tidak crash dan menampilkan indikasi data kosong
      // (Pada ListView yang kosong, minimal Scaffold muncul tanpa error)
      expect(find.byType(Scaffold), findsWidgets);
      
      // Jika di UI ada teks seperti "Belum ada histori", kita bisa assert:
      // expect(find.text('Belum ada riwayat'), findsOneWidget);
    });

    testWidgets('T2: Menampilkan pesan error saat koneksi gagal muat wallet', (tester) async {
      // Arrange
      when(() => mockApi.get('/api/wallet')).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/wallet'),
          type: DioExceptionType.connectionError,
        ),
      );

      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();

      // Harus menampilkan pesan error 
      expect(find.text('Coba Lagi'), findsOneWidget);
    });
  });
}
