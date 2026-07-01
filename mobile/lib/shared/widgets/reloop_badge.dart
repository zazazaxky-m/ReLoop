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
    final colors = context.reloopTone(tone.name);

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
}

enum BadgeTone { success, warning, danger, info, neutral, brand }
