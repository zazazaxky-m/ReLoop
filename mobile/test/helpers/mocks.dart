import 'package:mocktail/mocktail.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockFlutterSecureStorage extends Mock implements FlutterSecureStorage {}

// Fallback values for mocktail to work with custom types
void registerFallbackValues() {
  // If we ever need to mock methods with custom types as arguments,
  // we register them here.
  // registerFallbackValue(Uri());
}
