import 'package:flutter/material.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../theme/colors.dart';
import 'superadmin_shell.dart';

class SuperadminConfigScreen extends StatelessWidget {
  const SuperadminConfigScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return SuperadminShell(
      title: 'Konfigurasi Sistem',
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ReLoopCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: ReLoopColors.brand50, borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.tune, color: ReLoopColors.brand600, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('Pengaturan Umum', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                const Icon(Icons.chevron_right, color: ReLoopColors.mutedSoft),
              ]),
              const SizedBox(height: 8),
              const Text('Konfigurasi dasar aplikasi.', style: TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
            ]),
          ),
          const SizedBox(height: 10),
          ReLoopCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: ReLoopColors.info.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.notifications_outlined, color: ReLoopColors.info, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('Notifikasi', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                const Icon(Icons.chevron_right, color: ReLoopColors.mutedSoft),
              ]),
              const SizedBox(height: 8),
              const Text('Pengaturan notifikasi push dan email.', style: TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
            ]),
          ),
          const SizedBox(height: 10),
          ReLoopCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: ReLoopColors.warning.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.monetization_on_outlined, color: ReLoopColors.warning, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('Reward & Poin', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                const Icon(Icons.chevron_right, color: ReLoopColors.mutedSoft),
              ]),
              const SizedBox(height: 8),
              const Text('Konfigurasi sistem reward dan poin.', style: TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
            ]),
          ),
          const SizedBox(height: 10),
          ReLoopCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: ReLoopColors.success.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.backup_outlined, color: ReLoopColors.success, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('Backup & Restore', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                const Icon(Icons.chevron_right, color: ReLoopColors.mutedSoft),
              ]),
              const SizedBox(height: 8),
              const Text('Backup dan restore data sistem.', style: TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
            ]),
          ),
          const SizedBox(height: 10),
          ReLoopCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: ReLoopColors.danger.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.dangerous_outlined, color: ReLoopColors.danger, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('Mode Pemeliharaan', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                const SizedBox(width: 8),
                Switch.adaptive(value: false, onChanged: (_) {}),
              ]),
              const SizedBox(height: 8),
              const Text('Aktifkan mode pemeliharaan untuk menonaktifkan akses pengguna.', style: TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
            ]),
          ),
        ],
      ),
    );
  }
}
