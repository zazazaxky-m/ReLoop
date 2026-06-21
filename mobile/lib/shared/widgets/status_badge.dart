import 'package:flutter/material.dart';
import 'reloop_badge.dart';

class StatusBadge extends StatelessWidget {
  final String statusKey;

  const StatusBadge({super.key, required this.statusKey});

  static const _registry = <String, _StatusEntry>{
    'ONLINE': _StatusEntry('Online', BadgeTone.success, Icons.signal_cellular_alt),
    'OFFLINE': _StatusEntry('Offline', BadgeTone.neutral, Icons.power_settings_new),
    'FULL': _StatusEntry('Penuh', BadgeTone.warning, Icons.inventory_2),
    'MAINTENANCE': _StatusEntry('Maintenance', BadgeTone.info, Icons.build),
    'ERROR': _StatusEntry('Error', BadgeTone.danger, Icons.warning_amber_rounded),
    'ACTIVE': _StatusEntry('Aktif', BadgeTone.brand, Icons.bolt),
    'PROCESSING_ITEM': _StatusEntry('Memproses', BadgeTone.info, Icons.hourglass_top),
    'COMPLETED': _StatusEntry('Selesai', BadgeTone.success, Icons.check_circle_outline),
    'REVIEW': _StatusEntry('Ditinjau', BadgeTone.warning, Icons.warning_amber_rounded),
    'CANCELLED': _StatusEntry('Dibatalkan', BadgeTone.neutral, Icons.cancel_outlined),
    'EXPIRED': _StatusEntry('Kedaluwarsa', BadgeTone.neutral, Icons.hourglass_bottom),
    'PENDING': _StatusEntry('Pending', BadgeTone.warning, Icons.hourglass_top),
    'ACCEPTED': _StatusEntry('Diterima', BadgeTone.success, Icons.check_circle_outline),
    'REJECTED': _StatusEntry('Ditolak', BadgeTone.danger, Icons.cancel_outlined),
    'AVAILABLE': _StatusEntry('Tersedia', BadgeTone.success, Icons.check_circle_outline),
    'REDEEMED': _StatusEntry('Dicairkan', BadgeTone.info, Icons.info_outline),
    'REVERSED': _StatusEntry('Dikoreksi', BadgeTone.neutral, Icons.fiber_manual_record),
    'REQUESTED': _StatusEntry('Diminta', BadgeTone.info, Icons.hourglass_top),
    'APPROVED': _StatusEntry('Disetujui', BadgeTone.info, Icons.check_circle_outline),
    'PROCESSING': _StatusEntry('Diproses', BadgeTone.info, Icons.hourglass_top),
    'SUCCESS': _StatusEntry('Sukses', BadgeTone.success, Icons.check_circle_outline),
    'FAILED': _StatusEntry('Gagal', BadgeTone.danger, Icons.cancel_outlined),
    'ASSIGNED': _StatusEntry('Ditugaskan', BadgeTone.info, Icons.person),
    'ON_THE_WAY': _StatusEntry('Dalam Perjalanan', BadgeTone.brand, Icons.local_shipping),
    'ARRIVED': _StatusEntry('Tiba', BadgeTone.brand, Icons.location_on),
    'COLLECTED': _StatusEntry('Diambil', BadgeTone.success, Icons.check_circle_outline),
    'INVITED': _StatusEntry('Diundang', BadgeTone.info, Icons.info_outline),
    'PENDING_SUPERADMIN_APPROVAL': _StatusEntry('Menunggu Approval', BadgeTone.warning, Icons.hourglass_top),
    'SUSPENDED': _StatusEntry('Ditangguhkan', BadgeTone.warning, Icons.warning_amber_rounded),
    'REMOVED': _StatusEntry('Dihapus', BadgeTone.neutral, Icons.cancel_outlined),
    'DRAFT': _StatusEntry('Draft', BadgeTone.neutral, Icons.fiber_manual_record),
    'PAUSED': _StatusEntry('Dijeda', BadgeTone.warning, Icons.hourglass_top),
    'ENDED': _StatusEntry('Berakhir', BadgeTone.neutral, Icons.fiber_manual_record),
    'PICKUP_REQUESTED': _StatusEntry('Pickup Diminta', BadgeTone.info, Icons.local_shipping),
    'PENDING_REWARD': _StatusEntry('Reward Pending', BadgeTone.warning, Icons.hourglass_top),
  };

  @override
  Widget build(BuildContext context) {
    final entry = _registry[statusKey] ??
        _StatusEntry(_humanize(statusKey), BadgeTone.neutral, Icons.fiber_manual_record);

    return ReLoopBadge(
      label: entry.label,
      tone: entry.tone,
      icon: entry.icon,
    );
  }

  static String _humanize(String key) {
    return key
        .replaceAll('_', ' ')
        .split(' ')
        .map((w) => w.isEmpty ? '' : '${w[0]}${w.substring(1).toLowerCase()}')
        .join(' ');
  }
}

class _StatusEntry {
  final String label;
  final BadgeTone tone;
  final IconData icon;
  const _StatusEntry(this.label, this.tone, this.icon);
}
