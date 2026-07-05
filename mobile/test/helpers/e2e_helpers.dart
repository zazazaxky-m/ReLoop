import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Membantu melewati Onboarding screen jika sedang aktif.
Future<void> skipOnboarding(WidgetTester tester) async {
  await tester.pumpAndSettle();
  final skipButton = find.text('Lewati');
  if (skipButton.evaluate().isNotEmpty) {
    await tester.tap(skipButton);
    await tester.pumpAndSettle();
  }
}

/// Helper untuk melakukan login.
Future<void> loginAs(WidgetTester tester, String email, String password) async {
  await skipOnboarding(tester);

  // Pastikan kita ada di halaman login (cari text field Email)
  final emailField = find.widgetWithText(TextFormField, 'nama@email.com');
  
  if (emailField.evaluate().isEmpty) {
    // Jika tidak di login (mungkin masih di Register atau di Onboarding), navigasi manual atau biarkan gagal
    throw Exception('Tidak berada di halaman login. Field Email tidak ditemukan.');
  }

  // Isi form
  await tester.enterText(emailField, email);
  await tester.pumpAndSettle();

  final passwordField = find.widgetWithText(TextFormField, '••••••••');
  await tester.enterText(passwordField, password);
  await tester.pumpAndSettle();

  // Tekan tombol Masuk
  final loginButtonText = find.text('Masuk').last;
  await tester.tap(loginButtonText);
  
  // Tunggu proses request dan animasi perpindahan halaman selesai
  await tester.pumpAndSettle(const Duration(seconds: 3));
}

/// Helper untuk melakukan logout dari Dashboard/Profile.
Future<void> logoutUser(WidgetTester tester) async {
  // Buka profil jika kita belum berada di sana
  // Kita cari item navigasi bawah "Lainnya" lalu "Profil", atau langsung "Profil".
  final profileMenu = find.text('Profil');
  if (profileMenu.evaluate().isNotEmpty) {
    await tester.tap(profileMenu.last);
    await tester.pumpAndSettle();
  } else {
    // Coba cari circle avatar di AppBar
    final avatar = find.byType(CircleAvatar);
    if (avatar.evaluate().isNotEmpty) {
      await tester.tap(avatar);
      await tester.pumpAndSettle();
    }
  }

  // Scroll ke bawah untuk mencari tombol keluar (karena di dalam ListView)
  final listView = find.byType(ListView);
  if (listView.evaluate().isNotEmpty) {
    await tester.drag(listView.first, const Offset(0, -1000));
    await tester.pumpAndSettle();
  }

  // Cari tombol keluar
  final logoutButton = find.text('Keluar');
  if (logoutButton.evaluate().isNotEmpty) {
    await tester.tap(logoutButton);
    await tester.pumpAndSettle();
    
    // Konfirmasi dialog keluar
    final confirmButton = find.text('Keluar').last;
    if (confirmButton.evaluate().isNotEmpty) {
      await tester.tap(confirmButton);
      await tester.pumpAndSettle();
    }
  } else {
    throw Exception('Tombol Keluar tidak ditemukan');
  }
}
