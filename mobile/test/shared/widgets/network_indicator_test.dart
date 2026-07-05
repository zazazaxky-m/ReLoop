import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/providers/connectivity_provider.dart';
import 'package:reloop_mobile/shared/widgets/network_indicator.dart';

class FakeConnectivityProvider extends ChangeNotifier implements ConnectivityProvider {
  bool _isOnline;
  FakeConnectivityProvider({bool initialOnline = true}) : _isOnline = initialOnline;

  @override
  bool get isOnline => _isOnline;

  void setOnline(bool value) {
    _isOnline = value;
    notifyListeners();
  }
}

void main() {
  testWidgets('NetworkAwareWidget hides banner when online', (WidgetTester tester) async {
    final fakeProvider = FakeConnectivityProvider(initialOnline: true);
    
    await tester.pumpWidget(MaterialApp(
      home: ChangeNotifierProvider<ConnectivityProvider>.value(
        value: fakeProvider,
        child: const Scaffold(
          body: NetworkAwareWidget(
            child: Text('Content'),
          ),
        ),
      ),
    ));

    expect(find.text('Content'), findsOneWidget);
    expect(find.byIcon(Icons.wifi_off), findsNothing);
  });

  testWidgets('NetworkAwareWidget shows banner when offline', (WidgetTester tester) async {
    final fakeProvider = FakeConnectivityProvider(initialOnline: false);
    
    await tester.pumpWidget(MaterialApp(
      home: ChangeNotifierProvider<ConnectivityProvider>.value(
        value: fakeProvider,
        child: const Scaffold(
          body: NetworkAwareWidget(
            child: Text('Content'),
          ),
        ),
      ),
    ));

    expect(find.text('Content'), findsOneWidget);
    expect(find.byIcon(Icons.wifi_off), findsOneWidget);
    expect(find.textContaining('Tidak ada koneksi internet'), findsOneWidget);
  });
}
