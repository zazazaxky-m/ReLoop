import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/reloop_card.dart';

void main() {
  Widget wrapInMaterial(Widget child) {
    return MaterialApp(
      home: Scaffold(
        body: Center(child: child),
      ),
    );
  }

  group('ReLoopCard Widget Test', () {
    testWidgets('T1: Rendering Card dasar tanpa error', (tester) async {
      await tester.pumpWidget(
        wrapInMaterial(
          const ReLoopCard(
            child: Text('Konten Card'),
          ),
        ),
      );

      expect(find.text('Konten Card'), findsOneWidget);
      expect(find.byType(Container), findsWidgets);
    });

    testWidgets('T2: ReLoopCardHeader rendering title correctly', (tester) async {
      await tester.pumpWidget(
        wrapInMaterial(
          const ReLoopCardHeader(
            child: ReLoopCardTitle(title: 'Header Judul'),
          ),
        ),
      );

      expect(find.text('Header Judul'), findsOneWidget);
    });

    testWidgets('T3: ReLoopCardFooter rendering child', (tester) async {
      await tester.pumpWidget(
        wrapInMaterial(
          const ReLoopCardFooter(
            child: Text('Tombol Footer'),
          ),
        ),
      );

      expect(find.text('Tombol Footer'), findsOneWidget);
    });

    testWidgets('T4: custom padding and margin', (tester) async {
      await tester.pumpWidget(
        wrapInMaterial(
          const ReLoopCard(
            padding: EdgeInsets.all(8),
            margin: EdgeInsets.all(4),
            child: Text('Padded'),
          ),
        ),
      );
      expect(find.text('Padded'), findsOneWidget);
    });
  });
}
