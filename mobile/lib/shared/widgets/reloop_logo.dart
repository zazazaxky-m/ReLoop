import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class ReLoopLogo extends StatelessWidget {
  final double height;
  final bool compact;

  const ReLoopLogo({super.key, this.height = 40, this.compact = false});

  @override
  Widget build(BuildContext context) {
    final asset = compact ? 'assets/images/reloop-logo.svg' : 'assets/images/reloop-logo-name.svg';
    return SvgPicture.asset(
      asset,
      height: height,
    );
  }
}
