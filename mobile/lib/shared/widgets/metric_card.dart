import 'package:flutter/material.dart';
import '../../theme/colors.dart';

enum MetricTone { green, amber, blue, teal, slate, red, violet }

class MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final String? hint;
  final IconData icon;
  final MetricTone tone;
  final Widget? trailing;
  final bool compact;

  const MetricCard({
    super.key,
    required this.label,
    required this.value,
    this.hint,
    required this.icon,
    this.tone = MetricTone.green,
    this.trailing,
    this.compact = false,
  });

  _TonePalette _palette(BuildContext context) {
    final dark = context.isDarkMode;
    switch (tone) {
      case MetricTone.green:
        return _TonePalette(
          accent: dark ? ReLoopColors.brand300 : ReLoopColors.brand600,
          accentStrong: dark ? ReLoopColors.brand400 : ReLoopColors.brand700,
          surface: dark ? const Color(0xFF142B1E) : const Color(0xFFF1FBF4),
          surfaceHi: dark ? const Color(0xFF1B3527) : const Color(0xFFE6F6EC),
          iconBg: dark ? const Color(0xFF1F4530) : ReLoopColors.brand50,
          iconFg: dark ? ReLoopColors.brand300 : ReLoopColors.brand600,
        );
      case MetricTone.amber:
        return _TonePalette(
          accent: dark ? const Color(0xFFF5B85C) : const Color(0xFFB45309),
          accentStrong: dark ? const Color(0xFFFFC97A) : const Color(0xFF92400E),
          surface: dark ? const Color(0xFF2A1F10) : const Color(0xFFFFFBEB),
          surfaceHi: dark ? const Color(0xFF3A2A14) : const Color(0xFFFEF3C7),
          iconBg: dark ? const Color(0xFF3E2B18) : const Color(0xFFFFFBEB),
          iconFg: dark ? const Color(0xFFF5B85C) : const Color(0xFFB45309),
        );
      case MetricTone.blue:
        return _TonePalette(
          accent: dark ? const Color(0xFF77AFFF) : const Color(0xFF1D4ED8),
          accentStrong: dark ? const Color(0xFF8BBCFF) : const Color(0xFF1E40AF),
          surface: dark ? const Color(0xFF102036) : const Color(0xFFEFF6FF),
          surfaceHi: dark ? const Color(0xFF172D49) : const Color(0xFFDBEAFE),
          iconBg: dark ? const Color(0xFF1A2E4D) : const Color(0xFFEFF6FF),
          iconFg: dark ? const Color(0xFF8BBCFF) : const Color(0xFF1D4ED8),
        );
      case MetricTone.teal:
        return _TonePalette(
          accent: dark ? const Color(0xFF63D6CC) : const Color(0xFF0F766E),
          accentStrong: dark ? const Color(0xFF7AE2D8) : const Color(0xFF065F46),
          surface: dark ? const Color(0xFF102B28) : const Color(0xFFF0FDFA),
          surfaceHi: dark ? const Color(0xFF173936) : const Color(0xFFCCFBF1),
          iconBg: dark ? const Color(0xFF19413D) : const Color(0xFFF0FDFA),
          iconFg: dark ? const Color(0xFF70DDD2) : const Color(0xFF0F766E),
        );
      case MetricTone.slate:
        return _TonePalette(
          accent: dark ? const Color(0xFFCBD5E1) : const Color(0xFF334155),
          accentStrong: dark ? const Color(0xFFE2E8F0) : const Color(0xFF1E293B),
          surface: dark ? const Color(0xFF1B2229) : const Color(0xFFF1F5F9),
          surfaceHi: dark ? const Color(0xFF29322C) : const Color(0xFFE2E8F0),
          iconBg: dark ? const Color(0xFF29322C) : const Color(0xFFF1F5F9),
          iconFg: dark ? const Color(0xFFCBD5E1) : const Color(0xFF334155),
        );
      case MetricTone.red:
        return _TonePalette(
          accent: dark ? const Color(0xFFFCA5A5) : const Color(0xFFB91C1C),
          accentStrong: dark ? const Color(0xFFFECACA) : const Color(0xFF991B1B),
          surface: dark ? const Color(0xFF2A1313) : const Color(0xFFFEF2F2),
          surfaceHi: dark ? const Color(0xFF3A1A1A) : const Color(0xFFFEE2E2),
          iconBg: dark ? const Color(0xFF3A1A1A) : const Color(0xFFFEF2F2),
          iconFg: dark ? const Color(0xFFFCA5A5) : const Color(0xFFB91C1C),
        );
      case MetricTone.violet:
        return _TonePalette(
          accent: dark ? const Color(0xFFB8A5FF) : const Color(0xFF6D28D9),
          accentStrong: dark ? const Color(0xFFCDBFFF) : const Color(0xFF5B21B6),
          surface: dark ? const Color(0xFF1F1830) : const Color(0xFFF5F3FF),
          surfaceHi: dark ? const Color(0xFF2C2147) : const Color(0xFFEDE9FE),
          iconBg: dark ? const Color(0xFF2C2147) : const Color(0xFFF5F3FF),
          iconFg: dark ? const Color(0xFFB8A5FF) : const Color(0xFF6D28D9),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _palette(context);
    final radius = BorderRadius.circular(20);
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(compact ? 12 : 16),
      decoration: BoxDecoration(
        borderRadius: radius,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [p.surface, p.surfaceHi],
        ),
        border: Border.all(color: p.accent.withValues(alpha: 0.18)),
        boxShadow: context.isDarkMode
            ? const [
                BoxShadow(
                  color: Color(0x52000000),
                  blurRadius: 18,
                  offset: Offset(0, 8),
                ),
              ]
            : const [
                BoxShadow(
                  color: Color(0x080F172A),
                  blurRadius: 2,
                  offset: Offset(0, 1),
                ),
                BoxShadow(
                  color: Color(0x0A0F172A),
                  blurRadius: 24,
                  offset: Offset(0, 10),
                ),
              ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Container(
                width: compact ? 34 : 40,
                height: compact ? 34 : 40,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      p.iconBg,
                      p.accent.withValues(alpha: 0.22),
                    ],
                  ),
                  border: Border.all(
                    color: p.accent.withValues(alpha: 0.28),
                    width: 1,
                  ),
                ),
                child: Icon(
                  icon,
                  color: p.iconFg,
                  size: compact ? 17 : 19,
                ),
              ),
              const Spacer(),
              if (trailing != null) trailing!,
            ],
          ),
          SizedBox(height: compact ? 10 : 14),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
              color: context.reloopMuted,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: compact ? 20 : 24,
              fontWeight: FontWeight.w800,
              color: p.accentStrong,
              height: 1.1,
              letterSpacing: -0.4,
            ),
          ),
          if (hint != null) ...[
            const SizedBox(height: 4),
            Text(
              hint!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11.5,
                color: context.reloopMuted,
                height: 1.3,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _TonePalette {
  const _TonePalette({
    required this.accent,
    required this.accentStrong,
    required this.surface,
    required this.surfaceHi,
    required this.iconBg,
    required this.iconFg,
  });
  final Color accent;
  final Color accentStrong;
  final Color surface;
  final Color surfaceHi;
  final Color iconBg;
  final Color iconFg;
}
