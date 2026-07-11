import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/error_boundary.dart';
import 'package:reloop_mobile/shared/widgets/update_dialog.dart';
import 'package:reloop_mobile/theme/app_theme.dart';
import 'package:reloop_mobile/theme/colors.dart';
import 'package:reloop_mobile/core/models/redemption.dart';

void main() {
  testWidgets('ErrorBoundary.show snackbar with retry', (tester) async {
    var retried = false;
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => ErrorBoundary.show(
              context,
              message: 'Boom',
              onRetry: () => retried = true,
            ),
            child: const Text('Go'),
          ),
        ),
      ),
    ));

    await tester.tap(find.text('Go'));
    await tester.pump();
    expect(find.text('Boom'), findsOneWidget);
    expect(find.byType(SnackBarAction), findsOneWidget);
    final action = tester.widget<SnackBarAction>(find.byType(SnackBarAction));
    action.onPressed();
    expect(retried, isTrue);
  });

  testWidgets('ErrorBoundary.errorScreen with retry', (tester) async {
    var retried = false;
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: ErrorBoundary.errorScreen(
        message: 'Gagal',
        onRetry: () => retried = true,
      ),
    ));
    expect(find.text('Gagal'), findsOneWidget);
    await tester.tap(find.text('Coba Lagi'));
    expect(retried, isTrue);
  });

  testWidgets('ForceUpdateDialog.showIfNeeded and update tap', (tester) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/url_launcher'),
      (call) async => true,
    );

    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => ForceUpdateDialog.showIfNeeded(
              context,
              latestVersion: '2.0.0',
              changelog: 'Perbaikan bug',
            ),
            child: const Text('Show'),
          ),
        ),
      ),
    ));

    await tester.tap(find.text('Show'));
    await tester.pumpAndSettle();
    expect(find.text('Update Tersedia'), findsOneWidget);
    expect(find.textContaining('2.0.0'), findsOneWidget);
    expect(find.text('Perbaikan bug'), findsOneWidget);

    await tester.tap(find.text('Update Sekarang'));
    await tester.pump();
  });

  test('ReLoopColors tone fallback', () {
    expect(ReLoopColors.tones['missing'], isNull);
    final ctxTone = ReLoopColors.tones['neutral'];
    expect(ctxTone, isNotNull);
  });

  testWidgets('reloopTone falls back to neutral in dark mode', (tester) async {
    late ToneColors tone;
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.dark,
      home: Builder(
        builder: (context) {
          tone = context.reloopTone('does-not-exist');
          return const SizedBox();
        },
      ),
    ));
    expect(tone, ReLoopColors.tonesDark['neutral']);
  });

  test('Redemption statusLabel default branch', () {
    final r = Redemption(
      id: '1',
      amount: 1000,
      provider: 'BANK',
      status: 'WEIRD',
      createdAt: DateTime.now().toIso8601String(),
    );
    expect(r.statusLabel, 'WEIRD');
  });
}
