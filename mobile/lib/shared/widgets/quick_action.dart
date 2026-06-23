import 'package:flutter/material.dart';

import '../../theme/colors.dart';

enum QuickActionTone { green, blue, amber, teal }

class QuickAction extends StatelessWidget {
  const QuickAction({
    super.key,
    required this.icon,
    required this.title,
    required this.description,
    this.onTap,
    this.color,
    this.tone,
    this.badge,
  });

  final IconData icon;
  final String title;
  final String description;
  final VoidCallback? onTap;
  final Color? color;
  final QuickActionTone? tone;
  final String? badge;

  QuickActionTone get _resolvedTone {
    if (tone != null) return tone!;
    if (color == ReLoopColors.info) return QuickActionTone.blue;
    if (color == ReLoopColors.statusFull || color == ReLoopColors.warning) {
      return QuickActionTone.amber;
    }
    if (color == ReLoopColors.accent) return QuickActionTone.teal;
    return QuickActionTone.green;
  }

  ({Color background, Color icon, Color soft}) _colors(BuildContext context) {
    return switch (_resolvedTone) {
      QuickActionTone.green => (
        background: ReLoopColors.brand600,
        icon: Colors.white,
        soft: context.isDarkMode ? const Color(0xFF173D26) : ReLoopColors.brand50,
      ),
      QuickActionTone.blue => (
        background: const Color(0xFF2877D5),
        icon: Colors.white,
        soft: context.isDarkMode ? const Color(0xFF172D49) : const Color(0xFFEDF5FF),
      ),
      QuickActionTone.amber => (
        background: const Color(0xFFE48B19),
        icon: Colors.white,
        soft: context.isDarkMode ? const Color(0xFF3E2B18) : const Color(0xFFFFF5E7),
      ),
      QuickActionTone.teal => (
        background: const Color(0xFF159A91),
        icon: Colors.white,
        soft: context.isDarkMode ? const Color(0xFF173936) : const Color(0xFFEAF9F7),
      ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final palette = _colors(context);
    return Semantics(
      button: true,
      label: '$title. $description',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 2),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.start,
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Container(
                      width: 68,
                      height: 68,
                      decoration: BoxDecoration(
                        color: palette.soft,
                        borderRadius: BorderRadius.circular(21),
                      ),
                      child: Center(
                        child: Container(
                          width: 50,
                          height: 50,
                          decoration: BoxDecoration(
                            color: palette.background,
                            borderRadius: BorderRadius.circular(16),
                            boxShadow: [
                              BoxShadow(
                                color: palette.background.withValues(alpha: .2),
                                blurRadius: 12,
                                offset: const Offset(0, 5),
                              ),
                            ],
                          ),
                          child: Icon(icon, color: palette.icon, size: 27),
                        ),
                      ),
                    ),
                    if (badge != null)
                      Positioned(
                        top: -5,
                        right: -7,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1D211E),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: Colors.white, width: 2),
                          ),
                          child: Text(
                            badge!,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: context.reloopForeground,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    height: 1.15,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  description,
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: context.reloopMuted,
                    fontSize: 10,
                    height: 1.2,
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
