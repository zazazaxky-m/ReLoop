import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/skeleton_loading.dart';

void main() {
  group('SkeletonBox', () {
    testWidgets('renders with given dimensions', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonBox(width: 100, height: 20),
          ),
        ),
      );

      final container = tester.widget<Container>(find.byType(Container).first);
      final constraints = container.constraints;
      expect(constraints?.maxWidth, 100);
      expect(constraints?.maxHeight, 20);
    });
  });

  group('SkeletonCard', () {
    testWidgets('renders multiple skeleton elements', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: SkeletonCard()),
        ),
      );

      expect(find.byType(SkeletonCard), findsOneWidget);
    });
  });

  group('SkeletonListTile', () {
    testWidgets('renders list tile skeleton', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: SkeletonListTile()),
        ),
      );

      expect(find.byType(SkeletonListTile), findsOneWidget);
    });
  });

  group('SkeletonDashboard', () {
    testWidgets('renders full dashboard skeleton', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: SkeletonDashboard()),
        ),
      );

      expect(find.byType(SkeletonDashboard), findsOneWidget);
    });
  });
}
