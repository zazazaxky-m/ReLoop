import 'package:flutter/material.dart';
import '../../theme/colors.dart';

class ReLoopButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final ReLoopButtonVariant variant;
  final ReLoopButtonSize size;
  final IconData? icon;
  final bool isLoading;
  final bool expanded;

  const ReLoopButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = ReLoopButtonVariant.primary,
    this.size = ReLoopButtonSize.md,
    this.icon,
    this.isLoading = false,
    this.expanded = true,
  });

  @override
  Widget build(BuildContext context) {
    final isDisabled = onPressed == null || isLoading;

    return SizedBox(
      width: expanded ? double.infinity : null,
      height: size.height,
      child: ElevatedButton(
        onPressed: isDisabled ? null : onPressed,
        style: variant.style(context, size),
        child: isLoading
            ? SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: variant == ReLoopButtonVariant.primary ||
                          variant == ReLoopButtonVariant.danger
                      ? Colors.white
                      : ReLoopColors.brand600,
                ),
              )
            : Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (icon != null) ...[
                    Icon(icon, size: size.iconSize),
                    const SizedBox(width: 8),
                  ],
                  Flexible(
                    child: Text(
                      label,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: size.fontSize,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

enum ReLoopButtonVariant { primary, secondary, outline, ghost, danger }

extension _ButtonVariantStyle on ReLoopButtonVariant {
  ButtonStyle style(BuildContext context, ReLoopButtonSize size) {
    switch (this) {
      case ReLoopButtonVariant.primary:
        return ElevatedButton.styleFrom(
          backgroundColor: ReLoopColors.brand600,
          foregroundColor: Colors.white,
          disabledBackgroundColor: ReLoopColors.brand300,
          disabledForegroundColor: Colors.white70,
          padding: size.padding,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        );
      case ReLoopButtonVariant.secondary:
        return ElevatedButton.styleFrom(
          backgroundColor: ReLoopColors.brand50,
          foregroundColor: ReLoopColors.brand800,
          side: const BorderSide(color: ReLoopColors.brand200),
          disabledBackgroundColor: ReLoopColors.brand50,
          disabledForegroundColor: ReLoopColors.mutedSoft,
          padding: size.padding,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        );
      case ReLoopButtonVariant.outline:
        return OutlinedButton.styleFrom(
          foregroundColor: ReLoopColors.foreground,
          side: const BorderSide(color: ReLoopColors.border),
          padding: size.padding,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        );
      case ReLoopButtonVariant.ghost:
        return TextButton.styleFrom(
          foregroundColor: ReLoopColors.foreground,
          padding: size.padding,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        );
      case ReLoopButtonVariant.danger:
        return ElevatedButton.styleFrom(
          backgroundColor: ReLoopColors.danger,
          foregroundColor: Colors.white,
          disabledBackgroundColor: ReLoopColors.danger.withValues(alpha: 0.5),
          padding: size.padding,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        );
    }
  }
}

enum ReLoopButtonSize { sm, md, lg, icon }

extension _ButtonSizeStyle on ReLoopButtonSize {
  double get height {
    switch (this) {
      case ReLoopButtonSize.sm: return 32;
      case ReLoopButtonSize.md: return 44;
      case ReLoopButtonSize.lg: return 52;
      case ReLoopButtonSize.icon: return 44;
    }
  }

  double get fontSize {
    switch (this) {
      case ReLoopButtonSize.sm: return 13;
      case ReLoopButtonSize.md: return 14;
      case ReLoopButtonSize.lg: return 15;
      case ReLoopButtonSize.icon: return 14;
    }
  }

  double get iconSize {
    switch (this) {
      case ReLoopButtonSize.sm: return 16;
      case ReLoopButtonSize.md: return 18;
      case ReLoopButtonSize.lg: return 20;
      case ReLoopButtonSize.icon: return 20;
    }
  }

  EdgeInsets get padding {
    switch (this) {
      case ReLoopButtonSize.sm:
        return const EdgeInsets.symmetric(horizontal: 12, vertical: 6);
      case ReLoopButtonSize.md:
        return const EdgeInsets.symmetric(horizontal: 20, vertical: 12);
      case ReLoopButtonSize.lg:
        return const EdgeInsets.symmetric(horizontal: 28, vertical: 16);
      case ReLoopButtonSize.icon:
        return EdgeInsets.zero;
    }
  }
}
