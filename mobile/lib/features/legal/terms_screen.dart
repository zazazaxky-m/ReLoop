import 'package:flutter/material.dart';
import '../../theme/colors.dart';

class TermsScreen extends StatelessWidget {
  const TermsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Syarat & Ketentuan')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Syarat & Ketentuan ReLoop',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            Text(
              'Terakhir diperbarui: 1 Januari 2024',
              style: TextStyle(color: context.reloopMutedSoft, fontSize: 13),
            ),
            const SizedBox(height: 24),
            const _Section(
              title: '1. Pendahuluan',
              content:
                  'Dengan menggunakan aplikasi ReLoop, Anda menyetujui syarat dan ketentuan yang tercantum di bawah ini. Jika Anda tidak menyetujui, mohon untuk tidak menggunakan aplikasi ini.',
            ),
            const _Section(
              title: '2. Definisi',
              content:
                  'ReLoop adalah platform pengelolaan sampah digital yang menghubungkan pengguna dengan mesin Reverse Vending Machine (RVM) untuk mengumpulkan sampah daur ulang dan memberikan reward.',
            ),
            const _Section(
              title: '3. Akun Pengguna',
              content:
                  'Anda bertanggung jawab menjaga kerahasiaan akun dan password Anda. Segala aktivitas yang terjadi di akun Anda adalah tanggung jawab Anda sepenuhnya. Anda harus memberikan informasi yang akurat dan lengkap saat mendaftar.',
            ),
            const _Section(
              title: '4. Penggunaan Aplikasi',
              content:
                  'Aplikasi ini hanya boleh digunakan untuk tujuan yang sah. Dilarang menyalahgunakan aplikasi untuk kegiatan ilegal, penipuan, atau aktivitas yang melanggar hukum. Setiap penyalahgunaan akan mengakibatkan pembekuan akun.',
            ),
            const _Section(
              title: '5. Reward',
              content:
                  'Reward diberikan berdasarkan jenis dan jumlah sampah yang disetorkan. Besaran reward dapat berubah sewaktu-waktu. ReLoop berhak menolak atau menunda pencairan reward jika terdeteksi kecurangan.',
            ),
            const _Section(
              title: '6. Privasi',
              content:
                  'Kami menghargai privasi Anda. Informasi pribadi Anda hanya digunakan untuk keperluan operasional aplikasi dan tidak akan dijual kepada pihak ketiga tanpa izin Anda.',
            ),
            const _Section(
              title: '7. Perubahan',
              content:
                  'Kami berhak mengubah syarat dan ketentuan ini sewaktu-waktu. Perubahan akan diinformasikan melalui aplikasi. Penggunaan aplikasi setelah perubahan berarti Anda menyetujui ketentuan yang baru.',
            ),
            const SizedBox(height: 80),
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
          Text(
            title,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: context.reloopForeground,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            content,
            style: TextStyle(
              color: context.reloopMuted,
              fontSize: 14,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}
