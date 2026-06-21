import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../theme/colors.dart';

class TrashBagScreen extends StatelessWidget {
  const TrashBagScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Trash Bag')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: ReLoopColors.brand50,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: ReLoopColors.brand200),
              ),
              child: Column(
                children: [
                  const Icon(Icons.delete_outline, size: 48, color: ReLoopColors.brand500),
                  const SizedBox(height: 16),
                  const Text(
                    'Punya sampah tapi jauh dari mesin?\nGunakan Trash Bag!',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: ReLoopColors.brand800,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Foto dan submit sampah Anda. Tim kami akan menjemput atau Anda bisa drop-off ke mesin terdekat.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: ReLoopColors.muted.withValues(alpha: 0.8), fontSize: 13),
                  ),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: GestureDetector(
                          onTap: () => context.push('/trash-bags/create'),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            decoration: BoxDecoration(
                              color: ReLoopColors.brand600,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.add_photo_alternate_outlined,
                                    color: Colors.white, size: 18),
                                SizedBox(width: 8),
                                Text(
                                  'Submit Sampah',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 14,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: GestureDetector(
                          onTap: () => context.push('/trash-bags/history'),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            decoration: BoxDecoration(
                              border: Border.all(color: ReLoopColors.brand200),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.history,
                                    color: ReLoopColors.brand600, size: 18),
                                SizedBox(width: 8),
                                Text(
                                  'Riwayat',
                                  style: TextStyle(
                                    color: ReLoopColors.brand600,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 14,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'Cara Kerja Trash Bag',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: ReLoopColors.foreground,
              ),
            ),
            const SizedBox(height: 12),
            ReLoopCard(
              child: Column(
                children: [
                  _StepItem(
                    step: '1',
                    title: 'Pisahkan & Foto',
                    description: 'Pisahkan sampah per jenis dan ambil foto',
                  ),
                  const Divider(height: 24),
                  _StepItem(
                    step: '2',
                    title: 'Submit',
                    description: 'Isi jenis dan jumlah sampah',
                  ),
                  const Divider(height: 24),
                  _StepItem(
                    step: '3',
                    title: 'Verifikasi',
                    description: 'Admin akan verifikasi foto dan data',
                  ),
                  const Divider(height: 24),
                  _StepItem(
                    step: '4',
                    title: 'Dapatkan Reward',
                    description: 'Reward masuk ke saldo setelah diverifikasi',
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StepItem extends StatelessWidget {
  final String step;
  final String title;
  final String description;

  const _StepItem({
    required this.step,
    required this.title,
    required this.description,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: ReLoopColors.brand500,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Center(
            child: Text(
              step,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 14,
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  color: ReLoopColors.foreground,
                  fontSize: 14,
                ),
              ),
              Text(
                description,
                style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 12),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
