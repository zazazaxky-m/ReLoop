import 'package:flutter/material.dart';
import '../../theme/colors.dart';

enum QuickActionTone { green, blue, amber, teal }

class QuickAction extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  final VoidCallback? onTap;
  final Color? color;
  final QuickActionTone? tone;

  const QuickAction({
    super.key,
    required this.icon,
    required this.title,
    required this.description,
    this.onTap,
    this.color,
    this.tone,
  });

  QuickActionTone get _resolvedTone {
    if (tone != null) return tone!;
    if (color == null) return QuickActionTone.green;
    
    if (color == ReLoopColors.info) {
      return QuickActionTone.blue;
    } else if (color == ReLoopColors.statusFull || color == ReLoopColors.warning) {
      return QuickActionTone.amber;
    } else if (color == ReLoopColors.accent) {
      return QuickActionTone.teal;
    }
    return QuickActionTone.green;
  }

  Color _surfaceBg(QuickActionTone resolvedTone) {
    switch (resolvedTone) {
      case QuickActionTone.green:
        return ReLoopColors.brand50.withValues(alpha: 0.7);
      case QuickActionTone.blue:
        return const Color(0xFFEFF6FF).withValues(alpha: 0.7);
      case QuickActionTone.amber:
        return const Color(0xFFFFFBEB).withValues(alpha: 0.7);
      case QuickActionTone.teal:
        return const Color(0xFFF0FDFA).withValues(alpha: 0.7);
    }
  }

  Color _surfaceBorder(QuickActionTone resolvedTone) {
    switch (resolvedTone) {
      case QuickActionTone.green:
        return ReLoopColors.brand200;
      case QuickActionTone.blue:
        return const Color(0xFFBFDBFE);
      case QuickActionTone.amber:
        return const Color(0xFFFDE68A);
      case QuickActionTone.teal:
        return const Color(0xFF99F6E4);
    }
  }

  Color _iconBg(QuickActionTone resolvedTone) {
    switch (resolvedTone) {
      case QuickActionTone.green:
        return ReLoopColors.brand600;
      case QuickActionTone.blue:
        return const Color(0xFF2563EB);
      case QuickActionTone.amber:
        return const Color(0xFFD97706);
      case QuickActionTone.teal:
        return const Color(0xFF0D9488);
    }
  }

  Color _arrowColor(QuickActionTone resolvedTone) {
    switch (resolvedTone) {
      case QuickActionTone.green:
        return ReLoopColors.brand700;
      case QuickActionTone.blue:
        return const Color(0xFF1D4ED8);
      case QuickActionTone.amber:
        return const Color(0xFFB45309);
      case QuickActionTone.teal:
        return const Color(0xFF0F766E);
    }
  }

  @override
  Widget build(BuildContext context) {
    final resolvedTone = _resolvedTone;

    return Container(
      decoration: BoxDecoration(
        color: _surfaceBg(resolvedTone),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _surfaceBorder(resolvedTone)),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: _iconBg(resolvedTone),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, color: Colors.white, size: 18),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              title,
                              style: const TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.bold,
                                color: ReLoopColors.foreground,
                                height: 1.2,
                              ),
                            ),
                          ),
                          Icon(
                            Icons.arrow_outward,
                            size: 14,
                            color: _arrowColor(resolvedTone),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        description,
                        style: const TextStyle(
                          fontSize: 10.5,
                          color: ReLoopColors.muted,
                          height: 1.3,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
