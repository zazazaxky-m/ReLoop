import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/features/auth/login_screen.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/theme/app_theme.dart';
import 'package:provider/provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockAuthProvider mockAuth;

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    FlutterSecureStorage.setMockInitialValues({});
    mockAuth = MockAuthProvider();
    when(() => mockAuth.isLoading).thenReturn(false);
    when(() => mockAuth.error).thenReturn(null);
  });

  Widget buildScreen() {
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (context, state) => const LoginScreen()),
        GoRoute(path: '/dashboard', builder: (context, state) => const Scaffold()),
      ],
    );

    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
      ],
      child: MaterialApp.router(
        theme: AppTheme.light,
        routerConfig: router,
      ),
    );
  }

  testWidgets('LoginScreen renders fields and button', (WidgetTester tester) async {
    await tester.pumpWidget(buildScreen());

    expect(find.text('SELAMAT DATANG KEMBALI'), findsOneWidget);
    expect(find.byType(TextFormField), findsNWidgets(2)); // Email and Password
    expect(find.text('Masuk'), findsWidgets);
  });

  testWidgets('LoginScreen calls auth login on valid submit', (WidgetTester tester) async {
    when(() => mockAuth.login(any(), any())).thenAnswer((_) async => true);
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');
    
    await tester.pumpWidget(buildScreen());

    await tester.enterText(find.byType(TextFormField).first, 'test@example.com');
    await tester.enterText(find.byType(TextFormField).last, 'password123');
    await tester.pumpAndSettle();

    final submitButton = find.text('Masuk').last;
    await tester.ensureVisible(submitButton);
    await tester.tap(submitButton);
    await tester.pumpAndSettle();

    verify(() => mockAuth.login('test@example.com', 'password123')).called(1);
  });
}
