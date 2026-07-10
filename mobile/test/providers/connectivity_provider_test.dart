import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:reloop_mobile/providers/connectivity_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // Murni unit test tanpa mock channel mungkin melempar error.
  // Tapi dalam versi connectivity_plus terbaru, dia fallback ke 'none'
  // atau melempar MissingPluginException.
  // Untuk pengujian penuh plugin device, biasanya menggunakan MockPlatform.
  // Di sini kita cek ketersediaan class dan logic defaultnya.
  
  group('ConnectivityProvider', () {
    test('Can be instantiated', () {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        const MethodChannel('dev.fluttercommunity.plus/connectivity'),
        (MethodCall methodCall) async => ['wifi'],
      );

      final provider = ConnectivityProvider();
      expect(provider.isOnline, isTrue);
    });
  });
}
