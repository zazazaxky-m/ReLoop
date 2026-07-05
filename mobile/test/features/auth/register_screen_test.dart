import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/features/auth/register_screen.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/theme/app_theme.dart';
import 'package:provider/provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:go_router/go_router.dart';

class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockAuthProvider mockAuth;

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    mockAuth = MockAuthProvider();
    when(() => mockAuth.isLoading).thenReturn(false);
    when(() => mockAuth.error).thenReturn(null);
  });

  Widget buildScreen() {
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (context, state) => const RegisterScreen()),
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

  testWidgets('RegisterScreen renders fields and button', (WidgetTester tester) async {
    await tester.pumpWidget(buildScreen());

    expect(find.text('MULAI PERJALANANMU'), findsOneWidget);
    expect(find.byType(TextFormField), findsNWidgets(4)); // Name, Email, Phone, Password
    expect(find.text('Daftar'), findsWidgets);
  });

  testWidgets('RegisterScreen calls auth register on valid submit', (WidgetTester tester) async {
    when(() => mockAuth.register(any(), any(), any(), any())).thenAnswer((_) async => true);
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');
    
    await tester.pumpWidget(buildScreen());

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'John Doe');
    await tester.enterText(fields.at(1), 'test@example.com');
    await tester.enterText(fields.at(2), '081234567890');
    await tester.enterText(fields.at(3), 'password123');
    await tester.pumpAndSettle();

    final submitButton = find.text('Daftar').last;
    await tester.ensureVisible(submitButton);
    await tester.tap(submitButton);
    await tester.pumpAndSettle();

    verify(() => mockAuth.register('John Doe', 'test@example.com', 'password123', '081234567890')).called(1);
  });
}
