import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/quick_action.dart';

void main() {
  Widget wrapInMaterial(Widget child) {
    return MaterialApp(
      home: Scaffold(
        body: Center(child: child),
      ),
    );
  }

  group('QuickAction Widget Test', () {
    testWidgets('T1: Rendering Icon dan Label dengan benar', (tester) async {
      bool isTapped = false;
      await tester.pumpWidget(
        wrapInMaterial(
          QuickAction(
            icon: Icons.ac_unit,
            title: 'Salju',
            description: 'Fitur Salju',
            onTap: () {
              isTapped = true;
            },
          ),
        ),
      );

      // Verifikasi Teks
      expect(find.text('Salju'), findsOneWidget);
      expect(find.byIcon(Icons.ac_unit), findsOneWidget);

      // Tap aksi
      await tester.tap(find.byType(QuickAction));
      await tester.pumpAndSettle();

      expect(isTapped, isTrue);
    });

    testWidgets('T2: Rendering Badge', (tester) async {
      await tester.pumpWidget(
        wrapInMaterial(
          const QuickAction(
            icon: Icons.message,
            title: 'Pesan',
            description: 'Pesan Baru',
            badge: '5',
          ),
        ),
      );

      // Verifikasi badge text rendered
      expect(find.text('5'), findsOneWidget);
    });
  });
}
