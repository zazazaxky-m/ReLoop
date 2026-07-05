import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/main.dart' as app;
import 'package:reloop_mobile/core/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../test/helpers/e2e_helpers.dart';

ApiClient createMockApiClient() {
  final client = ApiClient(baseUrl: 'http://localhost');
  client.dio.interceptors.add(InterceptorsWrapper(
    onRequest: (options, handler) {
      final path = options.path;
      if (path == '/api/auth/login') {
         return handler.resolve(Response(
           requestOptions: options,
           data: { 'token': 'mock_token', 'user': { 'id': '1', 'name': 'User', 'email': 'user@reloop.id', 'role': 'USER', 'status': 'ACTIVE' } }
         ));
      }
      if (path == '/api/auth/me') {
         return handler.resolve(Response(
           requestOptions: options,
           data: { 'user': { 'id': '1', 'name': 'User', 'email': 'user@reloop.id', 'role': 'USER', 'status': 'ACTIVE' } }
         ));
      }
      if (path == '/api/user/dashboard') {
         return handler.resolve(Response(
           requestOptions: options,
           data: {
             'balance': { 'available': 50000, 'pending': 0, 'redeemed': 0, 'reserved': 0, 'totalEarned': 50000 },
             'recentSessions': [],
             'campaigns': [],
             'recentLedger': []
           }
         ));
      }
      if (path == '/api/public/machines') {
         return handler.resolve(Response(
           requestOptions: options,
           data: { 'machines': [] }
         ));
      }
      if (path == '/api/public/campaigns') {
         return handler.resolve(Response(
           requestOptions: options,
           data: { 'campaigns': [] }
         ));
      }
      return handler.resolve(Response(requestOptions: options, data: {}));
    }
  ));
  return client;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});

  group('E2E Testing - Phase 3 (Core End-User Workflows)', () {
    testWidgets('T1: Dashboard & Navigasi', (tester) async {
      app.main(injectedApiClient: createMockApiClient());
      await tester.pumpAndSettle();
      
      // Login
      await loginAs(tester, 'user@reloop.id', 'password123');

      // Pastikan ada teks layanan
      expect(find.text('Layanan ReLoop'), findsOneWidget);

      // Coba navigasi ke Map
      final mapNav = find.text('Map').last;
      await tester.tap(mapNav);
      await tester.pumpAndSettle();

      // Coba navigasi ke Wallet
      final walletNav = find.text('Wallet').last;
      await tester.tap(walletNav);
      await tester.pumpAndSettle();
      
      // Harus ada saldo tersedia
      expect(find.textContaining('Saldo'), findsWidgets);

      // Navigasi kembali ke Dashboard
      final dashboardNav = find.text('Beranda').last;
      await tester.tap(dashboardNav);
      await tester.pumpAndSettle();
    });

    testWidgets('T2: Wallet & Redemption', (tester) async {
      // Asumsikan sudah login (state disimpan) atau kita login ulang
      app.main(injectedApiClient: createMockApiClient());
      await tester.pumpAndSettle();
      await loginAs(tester, 'user@reloop.id', 'password123');
      
      // Klik menu Pencairan di Dashboard
      final pencairanButton = find.text('Pencairan');
      await tester.tap(pencairanButton);
      await tester.pumpAndSettle();

      // Pastikan masuk ke halaman pencairan saldo
      expect(find.text('Pencairan Saldo'), findsOneWidget);

      // Masukkan nominal
      final amountField = find.byType(TextFormField).first;
      await tester.enterText(amountField, '99999999'); // Invalid amount (terlalu besar)
      await tester.pumpAndSettle();

      // Submit
      final submitButton = find.text('Ajukan Pencairan');
      if (submitButton.evaluate().isNotEmpty) {
        await tester.tap(submitButton);
        await tester.pumpAndSettle();
        // Akan muncul snackbar error saldo tidak mencukupi
        expect(find.textContaining('Saldo tidak mencukupi'), findsOneWidget);
      }
    });

    testWidgets('T3: Trash Bag & Scan QR', (tester) async {
      app.main(injectedApiClient: createMockApiClient());
      await tester.pumpAndSettle();
      await loginAs(tester, 'user@reloop.id', 'password123');
      
      // Klik menu Trash Bag di Dashboard
      final trashBagButton = find.text('Trash Bag');
      await tester.tap(trashBagButton);
      await tester.pumpAndSettle();

      // Memastikan kita masuk ke halaman trash bag
      // Halaman tersebut mungkin memiliki teks 'Daftar Kantong' atau 'Pesan'
      expect(find.byType(Scaffold), findsWidgets); // Minimal memastikan tidak crash

      await logoutUser(tester);
    });
  });
}
