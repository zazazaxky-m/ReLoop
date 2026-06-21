import 'package:flutter_dotenv/flutter_dotenv.dart';

enum BuildEnvironment { development, staging, production }

class Environment {
  static BuildEnvironment current = BuildEnvironment.development;

  static String get apiBaseUrl {
    return dotenv.env['API_BASE_URL'] ?? 'http://localhost:3000';
  }

  static bool get isProduction => current == BuildEnvironment.production;
  static bool get isDevelopment => current == BuildEnvironment.development;

  static Future<void> load(BuildEnvironment env) async {
    current = env;
    switch (env) {
      case BuildEnvironment.development:
        await dotenv.load(fileName: '.env.development');
      case BuildEnvironment.staging:
        await dotenv.load(fileName: '.env.staging');
      case BuildEnvironment.production:
        await dotenv.load(fileName: '.env.production');
    }
  }

  static Map<String, String> get envVars {
    return Map<String, String>.from(dotenv.env);
  }

  String? get(String key) => dotenv.env[key];
}
