import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/skeleton_loading.dart';

void main() {
  Widget wrapInMaterial(Widget child) {
    return MaterialApp(
      home: Scaffold(
        body: Center(child: child),
      ),
    );
  }

  group('SkeletonBox Widget Test', () {
    testWidgets('T1: Rendering SkeletonBox dan animasinya tidak crash', (tester) async {
      await tester.pumpWidget(
        wrapInMaterial(
          const SkeletonBox(width: 100, height: 100),
        ),
      );

      // Verifikasi komponen dirender
      expect(find.byType(SkeletonBox), findsOneWidget);

      // Pompa satu frame animasi untuk memastikan ticker tidak error
      await tester.pump(const Duration(milliseconds: 100));
      
      final container = tester.widget<Container>(find.byType(Container).last);
      expect(container.constraints?.minWidth, 100);
      expect(container.constraints?.minHeight, 100);
    });
  });
}
