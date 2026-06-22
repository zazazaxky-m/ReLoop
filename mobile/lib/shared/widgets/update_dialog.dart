import 'package:flutter/material.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../theme/colors.dart';

class ForceUpdateDialog extends StatelessWidget {
  final String latestVersion;
  final String? changelog;

  const ForceUpdateDialog({
    super.key,
    required this.latestVersion,
    this.changelog,
  });

  static Future<void> showIfNeeded(BuildContext context, {required String latestVersion, String? changelog}) {
    return showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => ForceUpdateDialog(latestVersion: latestVersion, changelog: changelog),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            const Icon(Icons.system_update, color: ReLoopColors.brand500, size: 28),
            const SizedBox(width: 12),
            const Text('Update Tersedia', style: TextStyle(fontWeight: FontWeight.w800)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Versi baru ReLoop sudah tersedia. Silakan update untuk melanjutkan.', style: TextStyle(color: ReLoopColors.muted, fontSize: 14)),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: ReLoopColors.brand50,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: ReLoopColors.brand200),
              ),
              child: Row(
                children: [
                  const Icon(Icons.new_releases, color: ReLoopColors.brand500, size: 18),
                  const SizedBox(width: 8),
                  Text('Versi $latestVersion', style: const TextStyle(fontWeight: FontWeight.w700, color: ReLoopColors.brand700, fontSize: 14)),
                ],
              ),
            ),
            if (changelog != null) ...[
              const SizedBox(height: 12),
              Text(changelog!, style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 12)),
            ],
          ],
        ),
        actions: [
          ReLoopButton(
            label: 'Update Sekarang',
            icon: Icons.download,
            onPressed: () {},
          ),
        ],
      ),
    );
  }
}
