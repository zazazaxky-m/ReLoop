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

  group('Edge Cases - Server Errors', () {
    testWidgets('T1: Menampilkan error saat API merespons dengan 500 Internal Server Error', (tester) async {
      // Arrange
      when(() => mockApi.post(
            '/api/auth/login',
            data: any(named: 'data'),
          )).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/auth/login'),
          type: DioExceptionType.badResponse,
          response: Response(
            requestOptions: RequestOptions(path: '/api/auth/login'),
            statusCode: 500,
            data: 'Internal Server Error', // API crash tanpa balasan JSON rapi
          ),
        ),
      );

      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextFormField).first, 'user@reloop.id');
      await tester.enterText(find.byType(TextFormField).last, 'password123');
      
      await tester.tap(find.text('Masuk'));
      await tester.pumpAndSettle();

      // Assert error 500 muncul di layar
      expect(find.text('Terjadi kesalahan pada server.'), findsOneWidget);
    });

    testWidgets('T2: Menampilkan error saat API merespons 401 Sesi Habis', (tester) async {
      // Arrange
      when(() => mockApi.post(
            '/api/auth/login',
            data: any(named: 'data'),
          )).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/api/auth/login'),
          type: DioExceptionType.badResponse,
          response: Response(
            requestOptions: RequestOptions(path: '/api/auth/login'),
            statusCode: 401,
          ),
        ),
      );

      await tester.pumpWidget(createTestWidget());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextFormField).first, 'user@reloop.id');
      await tester.enterText(find.byType(TextFormField).last, 'password123');
      
      await tester.tap(find.text('Masuk'));
      await tester.pumpAndSettle();

      // Assert error 401 (tanpa body json khusus) jatuh ke fallback message
      expect(find.text('Sesi berakhir. Silakan login kembali.'), findsOneWidget);
    });
  });
}
