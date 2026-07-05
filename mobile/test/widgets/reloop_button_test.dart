import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/reloop_button.dart';

void main() {
  Widget wrapInMaterial(Widget child) {
    return MaterialApp(
      home: Scaffold(
        body: child,
      ),
    );
  }

  group('ReLoopButton Widget Test', () {
    testWidgets('T1: Default State - Tombol bisa ditekan', (tester) async {
      bool isPressed = false;
      await tester.pumpWidget(
        wrapInMaterial(
          ReLoopButton(
            label: 'Klik Saya',
            onPressed: () {
              isPressed = true;
            },
          ),
        ),
      );

      // Verifikasi Teks Muncul
      expect(find.text('Klik Saya'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      // Tekan tombol
      await tester.tap(find.byType(ReLoopButton));
      await tester.pumpAndSettle();

      // Verifikasi callback dipanggil
      expect(isPressed, isTrue);
    });

    testWidgets('T2: Loading State - Menampilkan loading, meniadakan tap', (tester) async {
      bool isPressed = false;
      await tester.pumpWidget(
        wrapInMaterial(
          ReLoopButton(
            label: 'Klik Saya',
            isLoading: true,
            onPressed: () {
              isPressed = true;
            },
          ),
        ),
      );

      // Teks tidak muncul karena diganti loading indicator
      expect(find.text('Klik Saya'), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Tekan tombol
      await tester.tap(find.byType(ReLoopButton));
      await tester.pump();

      // Verifikasi callback tidak terpanggil walau dicoba tap
      expect(isPressed, isFalse);
    });

    testWidgets('T3: Disabled State - Merender dimmed button jika onPressed null', (tester) async {
      await tester.pumpWidget(
        wrapInMaterial(
          const ReLoopButton(
            label: 'Mati',
            onPressed: null,
          ),
        ),
      );

      final elevatedButton = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
      expect(elevatedButton.onPressed, isNull);
    });
  });
}
