import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';

import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/features/auth/login_screen.dart';
import '../helpers/mocks.dart';

void main() {
  late MockApiClient mockApi;
  late AuthProvider authProvider;

  setUpAll(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  setUp(() {
    mockApi = MockApiClient();
    authProvider = AuthProvider(mockApi);
  });

  Widget createTestWidget() {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
      ],
      child: const MaterialApp(
        home: LoginScreen(),
      ),
    );
  }

  group('Edge Cases - Offline Mode & Timeout', () {
    testWidgets('T1: Menampilkan error saat koneksi timeout di halaman Login', (tester) async {
      // Arrange
      when(() => mockApi.post(
            '/api/auth/login',
            data: any(named: 'data'),
          )).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/auth/login'),
          type: DioExceptionType.connectionTimeout,
        ),
      );

      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();

      // Isi form
      await tester.enterText(find.byType(TextFormField).first, 'user@reloop.id');
      await tester.enterText(find.byType(TextFormField).last, 'password123');
      
      // Tekan tombol masuk
      await tester.tap(find.text('Masuk'));
      await tester.pumpAndSettle(); // Tunggu animasi loading dan state update

      // Assert error muncul di layar
      expect(find.text('Koneksi timeout. Periksa koneksi internet Anda.'), findsOneWidget);
    });

    testWidgets('T2: Menampilkan error saat tidak ada koneksi jaringan (ConnectionError)', (tester) async {
      // Arrange
      when(() => mockApi.post(
            '/api/auth/login',
            data: any(named: 'data'),
          )).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/auth/login'),
          type: DioExceptionType.connectionError,
        ),
      );

      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();

      // Isi form
      await tester.enterText(find.byType(TextFormField).first, 'user@reloop.id');
      await tester.enterText(find.byType(TextFormField).last, 'password123');
      
      // Tekan tombol masuk
      await tester.tap(find.text('Masuk'));
      await tester.pumpAndSettle();

      // Assert error muncul di layar
      expect(find.text('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.'), findsOneWidget);
    });
  });
}
