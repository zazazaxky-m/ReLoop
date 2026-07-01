import 'package:flutter/material.dart';
import '../../theme/colors.dart';

class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Tentang')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const SizedBox(height: 32),
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: ReLoopColors.brand500,
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(Icons.recycling, color: Colors.white, size: 48),
            ),
            const SizedBox(height: 16),
            Text(
              'ReLoop',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
                color: context.reloopForeground,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Versi 1.0.0',
              style: TextStyle(color: context.reloopMutedSoft, fontSize: 14),
            ),
            const SizedBox(height: 8),
            Text(
              'Build 1',
              style: TextStyle(color: context.reloopMutedSoft, fontSize: 12),
            ),
            const SizedBox(height: 32),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: context.reloopSurface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: context.reloopBorder),
              ),
              child: const Column(
                children: [
                  _AboutRow(label: 'Platform', value: 'Flutter'),
                  Divider(height: 20),
                  _AboutRow(label: 'Backend', value: 'Next.js'),
                  Divider(height: 20),
                  _AboutRow(label: 'Database', value: 'PostgreSQL'),
                ],
              ),
            ),
            const SizedBox(height: 40),
            Text(
              'ReLoop - Solusi Pengelolaan Sampah Digital',
              textAlign: TextAlign.center,
              style: TextStyle(color: context.reloopMuted, fontSize: 14),
            ),
            const SizedBox(height: 8),
            Text(
              'Dibuat dengan dedikasi untuk lingkungan yang lebih baik',
              textAlign: TextAlign.center,
              style: TextStyle(color: context.reloopMutedSoft, fontSize: 12),
            ),
            const SizedBox(height: 80),
          ],
        ),
      ),
    );
  }
}

class _AboutRow extends StatelessWidget {
  final String label;
  final String value;
  const _AboutRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(color: context.reloopMuted, fontSize: 14)),
        Text(
          value,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: context.reloopForeground,
            fontSize: 14,
          ),
        ),
      ],
    );
  }
}
