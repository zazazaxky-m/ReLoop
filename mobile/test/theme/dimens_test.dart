import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/theme/dimens.dart';

void main() {
  group('ReLoopSpacing', () {
    test('scale values are ordered', () {
      expect(ReLoopSpacing.xs, 4);
      expect(ReLoopSpacing.sm, 8);
      expect(ReLoopSpacing.md, 12);
      expect(ReLoopSpacing.lg, 16);
      expect(ReLoopSpacing.xl, 20);
      expect(ReLoopSpacing.xxl, 24);
      expect(ReLoopSpacing.xxxl, 32);
      expect(ReLoopSpacing.screen.left, 16);
      expect(ReLoopSpacing.screen.right, 16);
    });

    testWidgets('gap widgets have expected size', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Column(
            children: [
              ReLoopSpacing.gap4,
              ReLoopSpacing.gap8,
              ReLoopSpacing.gap12,
              ReLoopSpacing.gap16,
              ReLoopSpacing.gap20,
              ReLoopSpacing.gap24,
            ],
          ),
        ),
      );

      expect(find.byWidget(ReLoopSpacing.gap16), findsOneWidget);
      final box = tester.widget<SizedBox>(find.byWidget(ReLoopSpacing.gap16));
      expect(box.height, 16);
      expect(box.width, 16);
    });
  });

  group('ReLoopRadius', () {
    test('radius tokens exist', () {
      expect(ReLoopRadius.sm, 10);
      expect(ReLoopRadius.md, 14);
      expect(ReLoopRadius.lg, 20);
      expect(ReLoopRadius.xl, 28);
      expect(ReLoopRadius.pill, 999);
      expect(ReLoopRadius.brSm.topLeft.x, 10);
      expect(ReLoopRadius.brMd.topLeft.x, 14);
      expect(ReLoopRadius.brLg.topLeft.x, 20);
      expect(ReLoopRadius.brXl.topLeft.x, 28);
    });
  });

  group('ReLoopA11y', () {
    test('minimums match platform guidance', () {
      expect(ReLoopA11y.minTouchTarget, 48);
      expect(ReLoopA11y.minTextSize, 12);
    });
  });
}
