import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:reloop_mobile/main.dart' as app;

import '../test/helpers/e2e_helpers.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('E2E Testing - Phase 4 (Admin & Superadmin Workflows)', () {
    testWidgets('T1: Admin Dashboard & Navigasi', (tester) async {
      app.main();
      await tester.pumpAndSettle();
      
      // Login sebagai admin (asumsi ada seed admin@reloop.id)
      await loginAs(tester, 'admin@reloop.id', 'password123');

      // Memastikan kita ada di halaman dashboard admin
      expect(find.text('Beranda'), findsWidgets);
      
      // Navigasi ke Mesin
      final mesinNav = find.text('Mesin').last;
      await tester.tap(mesinNav);
      await tester.pumpAndSettle();
      expect(find.text('Daftar Mesin'), findsWidgets);

      // Navigasi ke Scan
      final scanNav = find.text('Scan').last;
      await tester.tap(scanNav);
      await tester.pumpAndSettle();
      // Harusnya tampil kamera/scanner screen
      
      // Navigasi ke Lainnya -> menu
      final lainnyaNav = find.text('Lainnya').last;
      await tester.tap(lainnyaNav);
      await tester.pumpAndSettle();
      
      // Di bottom sheet, cek apakah ada menu khusus admin (misalnya 'Trip / Trash Bag')
      expect(find.text('Trip / Trash Bag'), findsWidgets);

      // Tutup modal lalu logout
      await tester.tap(find.byType(Scaffold).first, warnIfMissed: false);
      await tester.pumpAndSettle();
      await logoutUser(tester);
    });

    testWidgets('T2: Superadmin Dashboard & Menu Khusus', (tester) async {
      app.main();
      await tester.pumpAndSettle();
      
      // Login sebagai superadmin
      await loginAs(tester, 'superadmin@reloop.id', 'password123');

      // Memastikan kita ada di halaman dashboard superadmin
      expect(find.text('Beranda'), findsWidgets);
      
      // Buka bottom sheet menu
      final lainnyaNav = find.text('Lainnya').last;
      await tester.tap(lainnyaNav);
      await tester.pumpAndSettle();
      
      // Superadmin punya menu khusus seperti Organisasi dan Audit Log
      expect(find.text('Organisasi'), findsWidgets);
      expect(find.text('Audit Log'), findsWidgets);

      // Tutup modal lalu logout
      await tester.tap(find.byType(Scaffold).first, warnIfMissed: false);
      await tester.pumpAndSettle();
      await logoutUser(tester);
    });
  });
}
