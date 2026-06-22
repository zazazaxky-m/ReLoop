import 'package:flutter/material.dart';
import '../../theme/colors.dart';

class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Kebijakan Privasi')),
      body: const SingleChildScrollView(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Kebijakan Privasi ReLoop', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            SizedBox(height: 16),
            Text('Terakhir diperbarui: 1 Januari 2024', style: TextStyle(color: ReLoopColors.mutedSoft, fontSize: 13)),
            SizedBox(height: 24),
            _PrivacySection(title: 'Data yang Kami Kumpulkan', content: 'Kami mengumpulkan informasi yang Anda berikan saat mendaftar: nama, email, nomor telepon, dan foto profil. Kami juga mengumpulkan data aktivitas setor sampah, lokasi mesin yang digunakan, dan riwayat reward.'),
            _PrivacySection(title: 'Penggunaan Data', content: 'Data Anda digunakan untuk: mengelola akun, memproses reward, mengirim notifikasi terkait aktivitas, meningkatkan layanan, dan keperluan analitik internal. Kami tidak menjual data Anda ke pihak ketiga.'),
            _PrivacySection(title: 'Keamanan Data', content: 'Kami menerapkan langkah keamanan teknis dan organisasi untuk melindungi data Anda. Data disimpan di server yang aman dengan enkripsi. Akses dibatasi hanya untuk personel yang berwenang.'),
            _PrivacySection(title: 'Hak Anda', content: 'Anda berhak: mengakses data pribadi Anda, meminta koreksi data, menghapus akun, dan menarik persetujuan kapan saja. Hubungi kami melalui email untuk menggunakan hak-hak tersebut.'),
            _PrivacySection(title: 'Cookie & Tracking', content: 'Aplikasi menggunakan teknologi tracking untuk analitik dan peningkatan layanan. Anda dapat menonaktifkan tracking di pengaturan perangkat.'),
            _PrivacySection(title: 'Kontak', content: 'Untuk pertanyaan tentang privasi: privacy@reloop.id'),
            SizedBox(height: 80),
          ],
        ),
      ),
    );
  }
}

class _PrivacySection extends StatelessWidget {
  final String title;
  final String content;
  const _PrivacySection({required this.title, required this.content});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: ReLoopColors.foreground)),
          const SizedBox(height: 6),
          Text(content, style: const TextStyle(color: ReLoopColors.muted, fontSize: 14, height: 1.5)),
        ],
      ),
    );
  }
}
