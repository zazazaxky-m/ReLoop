import 'package:flutter/material.dart';
import '../../theme/colors.dart';

class TermsScreen extends StatelessWidget {
  const TermsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Syarat & Ketentuan')),
      body: const SingleChildScrollView(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Syarat & Ketentuan ReLoop', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            SizedBox(height: 16),
            Text('Terakhir diperbarui: 1 Januari 2024', style: TextStyle(color: ReLoopColors.mutedSoft, fontSize: 13)),
            SizedBox(height: 24),
            _Section(title: '1. Pendahuluan', content: 'Dengan menggunakan aplikasi ReLoop, Anda menyetujui syarat dan ketentuan yang tercantum di bawah ini. Jika Anda tidak menyetujui, mohon untuk tidak menggunakan aplikasi ini.'),
            _Section(title: '2. Definisi', content: 'ReLoop adalah platform pengelolaan sampah digital yang menghubungkan pengguna dengan mesin Reverse Vending Machine (RVM) untuk mengumpulkan sampah daur ulang dan memberikan reward.'),
            _Section(title: '3. Akun Pengguna', content: 'Anda bertanggung jawab menjaga kerahasiaan akun dan password Anda. Segala aktivitas yang terjadi di akun Anda adalah tanggung jawab Anda sepenuhnya. Anda harus memberikan informasi yang akurat dan lengkap saat mendaftar.'),
            _Section(title: '4. Penggunaan Aplikasi', content: 'Aplikasi ini hanya boleh digunakan untuk tujuan yang sah. Dilarang menyalahgunakan aplikasi untuk kegiatan ilegal, penipuan, atau aktivitas yang melanggar hukum. Setiap penyalahgunaan akan mengakibatkan pembekuan akun.'),
            _Section(title: '5. Reward', content: 'Reward diberikan berdasarkan jenis dan jumlah sampah yang disetorkan. Besaran reward dapat berubah sewaktu-waktu. ReLoop berhak menolak atau menunda pencairan reward jika terdeteksi kecurangan.'),
            _Section(title: '6. Privasi', content: 'Kami menghargai privasi Anda. Informasi pribadi Anda hanya digunakan untuk keperluan operasional aplikasi dan tidak akan dijual kepada pihak ketiga tanpa izin Anda.'),
            _Section(title: '7. Perubahan', content: 'Kami berhak mengubah syarat dan ketentuan ini sewaktu-waktu. Perubahan akan diinformasikan melalui aplikasi. Penggunaan aplikasi setelah perubahan berarti Anda menyetujui ketentuan yang baru.'),
            SizedBox(height: 80),
          ],
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  final String title;
  final String content;
  const _Section({required this.title, required this.content});

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
