import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/core/page_transitions.dart';

void main() {
  test('styleForPath returns correct PageStyle', () {
    expect(styleForPath('/login'), equals(PageStyle.authFade));
    expect(styleForPath('/wallet/redemption'), equals(PageStyle.modalBottom));
    expect(styleForPath('/dashboard'), equals(PageStyle.fade));
    expect(styleForPath('/some-unknown-path'), equals(PageStyle.slideRight));
  });

  testWidgets('buildPage creates CustomTransitionPage with correct settings', (WidgetTester tester) async {
    final page = buildPage(
      key: const ValueKey('test'),
      child: const Text('Child'),
      style: PageStyle.fade,
    );

    expect(page.key, equals(const ValueKey('test')));
    expect(page.child, isA<Text>());
    expect(page.transitionDuration, const Duration(milliseconds: 220));
  });
}
