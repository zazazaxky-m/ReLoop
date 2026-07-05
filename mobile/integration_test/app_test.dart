import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:reloop_mobile/main.dart' as app;

import '../test/helpers/e2e_helpers.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('E2E Testing - Phase 2 (Auth & Onboarding)', () {
    testWidgets('T1: Onboarding berjalan sampai halaman login', (tester) async {
      // Jalankan aplikasi
      app.main();
      
      // Tunggu hingga app selesai rendering frame pertama
      await tester.pumpAndSettle();

      // Coba lewati onboarding
      await skipOnboarding(tester);

      // Verifikasi apakah sekarang kita berada di halaman login
      // Ciri-ciri halaman login: ada text field 'nama@email.com'
      expect(find.text('nama@email.com'), findsOneWidget);
    });

    testWidgets('T2: Login gagal jika email/password salah', (tester) async {
      app.main();
      await tester.pumpAndSettle();
      await skipOnboarding(tester);

      // Coba login dengan kredensial salah
      await loginAs(tester, 'salah@reloop.id', 'password_salah');
      
      // Verifikasi pesan error muncul
      expect(find.text('Kredensial tidak valid'), findsOneWidget);
    });

    testWidgets('T3: Login sukses sebagai User', (tester) async {
      app.main();
      await tester.pumpAndSettle();
      await skipOnboarding(tester);

      // Coba login dengan akun valid (tersedia dari seed)
      await loginAs(tester, 'user@reloop.id', 'password123');
      
      // Memastikan kita masuk ke Dashboard
      // Misalnya ada teks 'Saldo', 'Dashboard', atau semacamnya
      // Ciri khas halaman user adalah ada ReLoopLogo di appbar atau navigasi bawah
      expect(find.text('Beranda'), findsWidgets); // Navigasi bawah

      // Logout setelah selesai agar tidak mengganggu test berikutnya
      await logoutUser(tester);
      
      // Pastikan kembali ke halaman login
      expect(find.text('Masuk ke ReLoop'), findsOneWidget);
    });
  });
}
