import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:reloop_mobile/shared/widgets/reloop_logo.dart';

void main() {
  testWidgets('ReLoopLogo renders SvgPicture', (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: ReLoopLogo(compact: true),
      ),
    ));

    expect(find.byType(SvgPicture), findsOneWidget);
  });
}
