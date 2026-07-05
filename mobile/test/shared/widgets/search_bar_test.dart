import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/shared/widgets/search_bar.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

void main() {
  testWidgets('ReLoopSearchBar accepts input and can clear', (WidgetTester tester) async {
    String changedText = '';
    bool cleared = false;
    final controller = TextEditingController();
    
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: StatefulBuilder(
          builder: (context, setState) {
            return ReLoopSearchBar(
              controller: controller,
              hintText: 'Cari Produk',
              onChanged: (val) {
                setState(() {
                  changedText = val;
                });
              },
              onClear: () {
                setState(() {
                  cleared = true;
                });
              },
            );
          }
        ),
      ),
    ));

    expect(find.text('Cari Produk'), findsOneWidget);
    
    await tester.enterText(find.byType(TextField), 'Botol');
    await tester.pump();
    
    expect(changedText, equals('Botol'));
    expect(find.byIcon(Icons.clear), findsOneWidget);
    
    await tester.tap(find.byIcon(Icons.clear));
    await tester.pump();
    
    expect(changedText, equals(''));
    expect(cleared, isTrue);
    expect(controller.text, equals(''));
  });
}
