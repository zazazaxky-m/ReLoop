import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:reloop_mobile/main.dart' as app;

import '../test/helpers/e2e_helpers.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('E2E Testing - Phase 5 (Pengepul & Scan Workflows)', () {
    testWidgets('T1: Pengepul Dashboard', (tester) async {
      app.main();
      await tester.pumpAndSettle();
      
      // Login sebagai pengepul (asumsi kita buat/login dengan pengepul)
      // Di seed sebelumnya, mungkin ada 'pengepul@reloop.id'
      // Jika tidak ada, tes ini akan gagal di login, tapi strukturnya siap
      await loginAs(tester, 'pengepul@reloop.id', 'password123');

      // Harusnya tampil dashboard pengepul dengan map area
      // Contoh: Map Area Tugas, atau widget Map
      expect(find.textContaining('Area Tugas'), findsWidgets);
      
      await logoutUser(tester);
    });

    testWidgets('T2: Simulasi Buka QR Scanner', (tester) async {
      app.main();
      await tester.pumpAndSettle();
      
      // Login sebagai admin
      await loginAs(tester, 'admin@reloop.id', 'password123');
      
      // Navigasi ke Scan
      final scanNav = find.text('Scan').last;
      await tester.tap(scanNav);
      await tester.pumpAndSettle();
      
      // Pastikan layar scanner terbuka (terdapat text "Scan QR Kantong" atau sejenisnya)
      // Scanner widget biasa mengaktifkan kamera, di emulator mungkin hitam
      expect(find.textContaining('Arahkan kamera ke kode QR'), findsWidgets);
      
      // Test injection QR manual (mock) belum sepenuhnya diimplementasi di sini
      // Karena kita hanya menguji navigasi dan layar QR terbuka.
      // (Bypass sensor kamera butuh mock class MobileScannerController di aplikasi utamanya).

      // Kembali ke beranda
      final dashboardNav = find.text('Beranda').last;
      await tester.tap(dashboardNav);
      await tester.pumpAndSettle();

      await logoutUser(tester);
    });
  });
}
