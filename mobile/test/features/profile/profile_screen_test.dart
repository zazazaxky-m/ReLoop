import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/features/profile/profile_screen.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/providers/theme_provider.dart';
import 'package:reloop_mobile/theme/app_theme.dart';
import 'package:provider/provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class MockAuthProvider extends Mock implements AuthProvider {}
class MockApiClient extends Mock implements ApiClient {}
class MockThemeProvider extends Mock implements ThemeProvider {}

void main() {
  late MockAuthProvider mockAuth;
  late MockApiClient mockApi;
  late MockThemeProvider mockTheme;

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    FlutterSecureStorage.setMockInitialValues({});
    mockAuth = MockAuthProvider();
    mockApi = MockApiClient();
    mockTheme = MockThemeProvider();

    when(() => mockAuth.user).thenReturn(
      CurrentUser(id: '1', name: 'Test User', email: 'test@example.com', phone: '08123', role: AppRole.USER, status: 'ACTIVE')
    );
    when(() => mockTheme.isDark).thenReturn(false);
  });

  Widget buildScreen() {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
        ChangeNotifierProvider<ThemeProvider>.value(value: mockTheme),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const ProfileScreen(),
      ),
    );
  }

  testWidgets('ProfileScreen renders user info', (WidgetTester tester) async {
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.text('Test User'), findsWidgets);
    expect(find.text('test@example.com'), findsWidgets);
    expect(find.text('Pengaturan', skipOffstage: false), findsOneWidget);
    expect(find.text('Keluar', skipOffstage: false), findsOneWidget);
  });
}
