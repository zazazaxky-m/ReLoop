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
            const Icon(Icons.error_outline, size: 64, color: ReLoopColors.mutedSoft),
            const SizedBox(height: 16),
            Text(
              message ?? 'Terjadi kesalahan yang tidak terduga',
              textAlign: TextAlign.center,
              style: const TextStyle(color: ReLoopColors.muted, fontSize: 14),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Coba Lagi'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
