import 'package:flutter/material.dart';

import '../../theme/colors.dart';

class ReLoopBadge extends StatelessWidget {
  const ReLoopBadge({
    super.key,
    required this.label,
    this.tone = BadgeTone.neutral,
    this.icon,
    this.fontSize,
  });

  final String label;
  final BadgeTone tone;
  final IconData? icon;
  final double? fontSize;

  @override
  Widget build(BuildContext context) {
    final base = ReLoopColors.tones[tone.name]!;
    final colors = context.isDarkMode
        ? ToneColors(
            bg: base.text.withValues(alpha: .18),
            text: _darkText(tone),
            border: base.text.withValues(alpha: .38),
          )
        : base;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: colors.bg,
        borderRadius: BorderRadius.circular(7),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: colors.text),
            const SizedBox(width: 6),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: fontSize ?? 12,
              fontWeight: FontWeight.w600,
              color: colors.text,
            ),
          ),
        ],
      ),
    );
  }

  Color _darkText(BadgeTone value) {
    return switch (value) {
      BadgeTone.success => const Color(0xFF86E7A4),
      BadgeTone.warning => const Color(0xFFF5C06C),
      BadgeTone.danger => const Color(0xFFFF9292),
      BadgeTone.info => const Color(0xFF8BBCFF),
      BadgeTone.neutral => const Color(0xFFC3CDC6),
      BadgeTone.brand => ReLoopColors.brand300,
    };
  }
}

enum BadgeTone { success, warning, danger, info, neutral, brand }
