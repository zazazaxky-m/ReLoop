import 'package:flutter/material.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../theme/colors.dart';
import 'superadmin_shell.dart';

class SuperadminAuditScreen extends StatelessWidget {
  const SuperadminAuditScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return SuperadminShell(
      title: 'Keamanan & Audit',
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ReLoopCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: ReLoopColors.brand50, borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.history, color: ReLoopColors.brand600, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('Log Aktivitas', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                const Icon(Icons.chevron_right, color: ReLoopColors.mutedSoft),
              ]),
              const SizedBox(height: 8),
              const Text('Riwayat aktivitas pengguna dan admin.', style: TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
            ]),
          ),
          const SizedBox(height: 10),
          ReLoopCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: ReLoopColors.warning.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.shield_outlined, color: ReLoopColors.warning, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('Keamanan', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                const Icon(Icons.chevron_right, color: ReLoopColors.mutedSoft),
              ]),
              const SizedBox(height: 8),
              const Text('Pengaturan keamanan dan akses sistem.', style: TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
            ]),
          ),
          const SizedBox(height: 10),
          ReLoopCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: ReLoopColors.info.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.verified_user_outlined, color: ReLoopColors.info, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('Sesi Aktif', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                const Icon(Icons.chevron_right, color: ReLoopColors.mutedSoft),
              ]),
              const SizedBox(height: 8),
              const Text('Pantau sesi login yang sedang berjalan.', style: TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
            ]),
          ),
          const SizedBox(height: 10),
          ReLoopCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: ReLoopColors.danger.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.block_outlined, color: ReLoopColors.danger, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('IP Terblokir', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                const Icon(Icons.chevron_right, color: ReLoopColors.mutedSoft),
              ]),
              const SizedBox(height: 8),
              const Text('Daftar IP yang diblokir dari akses.', style: TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
            ]),
          ),
        ],
      ),
    );
  }
}
