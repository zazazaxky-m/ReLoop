import 'package:flutter/material.dart';

import '../../theme/colors.dart';
import '../../theme/dimens.dart';
import 'reloop_button.dart';

/// A consistent full-width empty state (icon + title + optional description)
/// so every screen renders "nothing here yet" the same way.
class ReLoopEmptyState extends StatelessWidget {
  const ReLoopEmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.description,
    this.compact = false,
  });

  final IconData icon;
  final String title;
  final String? description;

  /// When true, uses tighter vertical spacing for inline (in-card) usage.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(
        horizontal: ReLoopSpacing.xxl,
        vertical: compact ? ReLoopSpacing.xl : ReLoopSpacing.xxxl,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: compact ? 32 : 44, color: context.reloopMutedSoft),
          const SizedBox(height: ReLoopSpacing.md),
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if (description != null) ...[
            const SizedBox(height: ReLoopSpacing.xs),
            Text(
              description!,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ],
      ),
    );
  }
}

/// A consistent error state with a retry action, used for failed loads.
class ReLoopErrorState extends StatelessWidget {
  const ReLoopErrorState({
    super.key,
    required this.message,
    this.onRetry,
    this.icon = Icons.cloud_off_rounded,
    this.retryLabel = 'Coba lagi',
  });

  final String message;
  final VoidCallback? onRetry;
  final IconData icon;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(ReLoopSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: context.reloopMutedSoft),
            const SizedBox(height: ReLoopSpacing.md),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            if (onRetry != null) ...[
              const SizedBox(height: ReLoopSpacing.xl),
              ReLoopButton(
                label: retryLabel,
                icon: Icons.refresh_rounded,
                variant: ReLoopButtonVariant.outline,
                expanded: false,
                onPressed: onRetry,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Wraps [ReLoopErrorState] in a scrollable so it still works as the child of a
/// [RefreshIndicator] (pull-to-refresh needs an always-scrollable child).
class ReLoopErrorStateScrollable extends StatelessWidget {
  const ReLoopErrorStateScrollable({
    super.key,
    required this.message,
    this.onRetry,
  });

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: ReLoopErrorState(message: message, onRetry: onRetry),
          ),
        );
      },
    );
  }
}
