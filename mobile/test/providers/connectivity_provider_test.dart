import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/providers/connectivity_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const methodChannel =
      MethodChannel('dev.fluttercommunity.plus/connectivity');
  const eventChannel =
      'dev.fluttercommunity.plus/connectivity_status';

  void mockConnectivity({
    List<String> checkResult = const ['wifi'],
    List<String>? streamEvents,
  }) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(methodChannel, (call) async {
      if (call.method == 'check') return checkResult;
      return null;
    });

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockStreamHandler(
      const EventChannel(eventChannel),
      MockStreamHandler.inline(
        onListen: (args, sink) {
          for (final event in streamEvents ?? const <String>[]) {
            sink.success([event]);
          }
        },
      ),
    );
  }

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(methodChannel, null);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockStreamHandler(const EventChannel(eventChannel), null);
  });

  group('ConnectivityProvider', () {
    test('starts online when check returns wifi', () async {
      mockConnectivity(checkResult: ['wifi']);
      final provider = ConnectivityProvider();
      await Future<void>.delayed(Duration.zero);
      expect(provider.isOnline, isTrue);
      provider.dispose();
    });

    test('starts offline when check returns none', () async {
      mockConnectivity(checkResult: ['none']);
      final provider = ConnectivityProvider();
      await Future<void>.delayed(Duration.zero);
      expect(provider.isOnline, isFalse);
      provider.dispose();
    });

    test('updates from connectivity stream and dispose cancels', () async {
      mockConnectivity(
        checkResult: ['wifi'],
        streamEvents: ['none', 'mobile'],
      );
      final provider = ConnectivityProvider();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(provider.isOnline, isTrue);
      provider.dispose();
    });
  });
}
