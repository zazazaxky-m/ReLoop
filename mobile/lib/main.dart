import 'package:flutter/material.dart';

import 'src/api_client.dart';
import 'src/app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = ApiClient();
  await api.initialize();
  runApp(ReLoopApp(api: api));
}
