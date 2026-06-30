import 'package:flutter/material.dart';

import '../../theme/colors.dart';

class ReLoopCard extends StatelessWidget {
  const ReLoopCard({super.key, required this.child, this.padding, this.margin});

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: margin,
      padding: padding ?? const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.reloopSurfaceRaised,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: context.reloopBorder),
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
                  color: Color(0x0A0F172A),
                  blurRadius: 3,
                  offset: Offset(0, 1),
                ),
                BoxShadow(
                  color: Color(0x0A0F172A),
                  blurRadius: 28,
                  offset: Offset(0, 10),
                ),
              ],
      ),
      child: child,
    );
  }
}

class ReLoopCardHeader extends StatelessWidget {
  const ReLoopCardHeader({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: context.reloopBorder)),
        color: context.reloopSurfaceSoft,
      ),
      child: child,
    );
  }
}

class ReLoopCardTitle extends StatelessWidget {
  const ReLoopCardTitle({super.key, required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w700,
        color: context.reloopForeground,
      ),
    );
  }
}

class ReLoopCardFooter extends StatelessWidget {
  const ReLoopCardFooter({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: context.reloopBorder)),
        color: context.reloopSurfaceSoft,
      ),
      child: child,
    );
  }
}
