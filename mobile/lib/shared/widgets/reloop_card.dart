import 'package:flutter/material.dart';
import '../../theme/colors.dart';

class ReLoopCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;

  const ReLoopCard({
    super.key,
    required this.child,
    this.padding,
    this.margin,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: margin,
      padding: padding ?? const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ReLoopColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: ReLoopColors.border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A0F172A),
            blurRadius: 2,
            offset: Offset(0, 1),
          ),
          BoxShadow(
            color: Color(0x0A0F172A),
            blurRadius: 24,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: child,
    );
  }
}

class ReLoopCardHeader extends StatelessWidget {
  final Widget child;

  const ReLoopCardHeader({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: const BoxDecoration(
        border: Border(
          bottom: BorderSide(color: ReLoopColors.border),
        ),
        color: Color(0xFFF8FAF9),
      ),
      child: child,
    );
  }
}

class ReLoopCardTitle extends StatelessWidget {
  final String title;

  const ReLoopCardTitle({super.key, required this.title});

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w700,
        color: ReLoopColors.foreground,
      ),
    );
  }
}

class ReLoopCardFooter extends StatelessWidget {
  final Widget child;

  const ReLoopCardFooter({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: const BoxDecoration(
        border: Border(
          top: BorderSide(color: ReLoopColors.border),
        ),
        color: Color(0xFFF8FAF9),
      ),
      child: child,
    );
  }
}
