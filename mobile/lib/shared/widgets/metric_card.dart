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

  Color _toneColor(BuildContext context) {
    switch (tone) {
      case MetricTone.green: return context.isDarkMode ? ReLoopColors.brand300 : const Color(0xFF15803D);
      case MetricTone.amber: return context.isDarkMode ? const Color(0xFFF5B85C) : const Color(0xFFB45309);
      case MetricTone.blue: return context.isDarkMode ? const Color(0xFF77AFFF) : const Color(0xFF1D4ED8);
      case MetricTone.teal: return context.isDarkMode ? const Color(0xFF63D6CC) : const Color(0xFF0F766E);
      case MetricTone.slate: return context.isDarkMode ? const Color(0xFFCBD5E1) : const Color(0xFF334155);
    }
  }

  Color _toneBg(BuildContext context) {
    switch (tone) {
      case MetricTone.green: return context.isDarkMode ? const Color(0xFF173D26) : ReLoopColors.brand50;
      case MetricTone.amber: return context.isDarkMode ? const Color(0xFF3E2B18) : const Color(0xFFFFFBEB);
      case MetricTone.blue: return context.isDarkMode ? const Color(0xFF172D49) : const Color(0xFFEFF6FF);
      case MetricTone.teal: return context.isDarkMode ? const Color(0xFF173936) : const Color(0xFFF0FDFA);
      case MetricTone.slate: return context.isDarkMode ? const Color(0xFF29322C) : const Color(0xFFF1F5F9);
    }
  }

  Color _toneValueColor(BuildContext context) {
    switch (tone) {
      case MetricTone.green: return context.isDarkMode ? ReLoopColors.brand300 : ReLoopColors.brand800;
      case MetricTone.amber: return context.isDarkMode ? const Color(0xFFF5B85C) : const Color(0xFF92400E);
      case MetricTone.blue: return context.isDarkMode ? const Color(0xFF8BBCFF) : const Color(0xFF1E40AF);
      case MetricTone.teal: return context.isDarkMode ? const Color(0xFF70DDD2) : const Color(0xFF065F46);
      case MetricTone.slate: return context.isDarkMode ? const Color(0xFFE2E8F0) : const Color(0xFF1E293B);
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
            color: context.reloopSurfaceRaised,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: context.reloopBorder),
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
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.8,
                        color: context.reloopMuted,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: _toneBg(context),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(icon, color: _toneColor(context), size: 18),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                value,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: _toneValueColor(context),
                  height: 1.2,
                ),
              ),
              if (hint != null) ...[
                const SizedBox(height: 6),
                Text(
                  hint!,
                  style: TextStyle(
                    fontSize: 12,
                    color: context.reloopMuted,
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
