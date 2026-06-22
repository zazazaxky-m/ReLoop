import 'package:flutter/material.dart';
import '../../theme/colors.dart';

enum MetricTone { green, amber, blue, teal, slate }

class MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final String? hint;
  final IconData icon;
  final MetricTone tone;

  const MetricCard({
    super.key,
    required this.label,
    required this.value,
    this.hint,
    required this.icon,
    this.tone = MetricTone.green,
  });

  Color _toneBorderColor() {
    switch (tone) {
      case MetricTone.green: return ReLoopColors.brand500;
      case MetricTone.amber: return ReLoopColors.statusFull;
      case MetricTone.blue: return ReLoopColors.info;
      case MetricTone.teal: return ReLoopColors.accent;
      case MetricTone.slate: return ReLoopColors.neutral;
    }
  }

  Color _toneColor() {
    switch (tone) {
      case MetricTone.green: return const Color(0xFF15803D);
      case MetricTone.amber: return const Color(0xFFB45309);
      case MetricTone.blue: return const Color(0xFF1D4ED8);
      case MetricTone.teal: return const Color(0xFF0F766E);
      case MetricTone.slate: return const Color(0xFF334155);
    }
  }

  Color _toneBg() {
    switch (tone) {
      case MetricTone.green: return ReLoopColors.brand50;
      case MetricTone.amber: return const Color(0xFFFFFBEB);
      case MetricTone.blue: return const Color(0xFFEFF6FF);
      case MetricTone.teal: return const Color(0xFFF0FDFA);
      case MetricTone.slate: return const Color(0xFFF1F5F9);
    }
  }

  Color _toneValueColor() {
    switch (tone) {
      case MetricTone.green: return ReLoopColors.brand800;
      case MetricTone.amber: return const Color(0xFF92400E);
      case MetricTone.blue: return const Color(0xFF1E40AF);
      case MetricTone.teal: return const Color(0xFF065F46);
      case MetricTone.slate: return const Color(0xFF1E293B);
    }
  }

  @override
  Widget build(BuildContext context) {
    final borderTopColor = _toneBorderColor();
    return Stack(
      children: [
        Container(
          constraints: const BoxConstraints(minHeight: 128),
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: ReLoopColors.surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: ReLoopColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      label.toUpperCase(),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.8,
                        color: ReLoopColors.muted,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: _toneBg(),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(icon, color: _toneColor(), size: 18),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                value,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: _toneValueColor(),
                  height: 1.2,
                ),
              ),
              if (hint != null) ...[
                const SizedBox(height: 6),
                Text(
                  hint!,
                  style: const TextStyle(
                    fontSize: 12,
                    color: ReLoopColors.muted,
                    height: 1.3,
                  ),
                ),
              ],
            ],
          ),
        ),
        Positioned(
          top: 0, left: 0, right: 0,
          child: Container(
            height: 4,
            decoration: BoxDecoration(
              color: borderTopColor,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(8),
                topRight: Radius.circular(8),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
