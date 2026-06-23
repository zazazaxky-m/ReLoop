import 'package:flutter/material.dart';
import '../../theme/colors.dart';

class ErrorBoundary extends StatelessWidget {
  final Widget child;
  final String? title;
  final String? message;
  final VoidCallback? onRetry;

  const ErrorBoundary({
    super.key,
    required this.child,
    this.title,
    this.message,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return child;
  }

  static void show(BuildContext context, {String? message, VoidCallback? onRetry}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message ?? 'Terjadi kesalahan'),
        action: onRetry != null
            ? SnackBarAction(label: 'Coba Lagi', onPressed: onRetry)
            : null,
        backgroundColor: ReLoopColors.danger,
      ),
    );
  }

  static Widget errorScreen({String? message, VoidCallback? onRetry}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 64, color: context.reloopMutedSoft),
            const SizedBox(height: 16),
            Text(
              message ?? 'Terjadi kesalahan yang tidak terduga',
              textAlign: TextAlign.center,
              style: TextStyle(color: context.reloopMuted, fontSize: 14),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: onRetry,
                icon: Icon(Icons.refresh, size: 18),
                label: Text('Coba Lagi'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
