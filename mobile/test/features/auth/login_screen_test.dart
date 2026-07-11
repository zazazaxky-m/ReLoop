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

  Widget buildScreen({List<RouteBase> extraRoutes = const []}) {
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (context, state) => const LoginScreen()),
        GoRoute(
          path: '/dashboard',
          builder: (context, state) => const Scaffold(body: Text('dash')),
        ),
        GoRoute(
          path: '/forgot-password',
          builder: (context, state) =>
              const Scaffold(body: Text('forgot page')),
        ),
        GoRoute(
          path: '/register',
          builder: (context, state) =>
              const Scaffold(body: Text('register page')),
        ),
        GoRoute(
          path: '/onboarding',
          builder: (context, state) =>
              const Scaffold(body: Text('onboarding page')),
        ),
        ...extraRoutes,
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

  testWidgets('LoginScreen renders fields and button', (tester) async {
    await tester.pumpWidget(buildScreen());
    await tester.pump();

    expect(find.text('SELAMAT DATANG KEMBALI'), findsOneWidget);
    expect(find.byType(TextFormField), findsNWidgets(2));
    expect(find.text('Masuk'), findsWidgets);
  });

  testWidgets('LoginScreen calls auth login on valid submit', (tester) async {
    when(() => mockAuth.login(any(), any())).thenAnswer((_) async => true);
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');

    await tester.pumpWidget(buildScreen());
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).first, 'test@example.com');
    await tester.enterText(find.byType(TextFormField).last, 'password123');
    await tester.pumpAndSettle();

    final submitButton = find.text('Masuk').last;
    await tester.ensureVisible(submitButton);
    await tester.tap(submitButton);
    await tester.pumpAndSettle();

    verify(() => mockAuth.login('test@example.com', 'password123')).called(1);
    expect(find.text('dash'), findsOneWidget);
  });

  testWidgets('toggles password visibility', (tester) async {
    await tester.pumpWidget(buildScreen());
    await tester.pump();

    expect(find.byIcon(Icons.visibility_off_outlined), findsOneWidget);
    await tester.tap(find.byIcon(Icons.visibility_off_outlined));
    await tester.pump();
    expect(find.byIcon(Icons.visibility_outlined), findsOneWidget);
  });

  testWidgets('shows auth error banner', (tester) async {
    when(() => mockAuth.error).thenReturn('Email atau password salah');
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    expect(find.text('Email atau password salah'), findsOneWidget);
  });

  testWidgets('navigates to forgot password and register', (tester) async {
    await tester.pumpWidget(buildScreen());
    await tester.pump();

    await tester.ensureVisible(find.text('Lupa kata sandi?'));
    await tester.tap(find.text('Lupa kata sandi?'));
    await tester.pumpAndSettle();
    expect(find.text('forgot page'), findsOneWidget);

    // Go back via router by rebuilding at login
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    await tester.ensureVisible(find.textContaining('Belum punya akun'));
    await tester.tap(find.textContaining('Belum punya akun'));
    await tester.pumpAndSettle();
    expect(find.text('register page'), findsOneWidget);
  });

  testWidgets('navigates to onboarding', (tester) async {
    await tester.pumpWidget(buildScreen());
    await tester.pump();

    await tester.ensureVisible(find.textContaining('Kembali ke pengenalan'));
    await tester.tap(find.textContaining('Kembali ke pengenalan'));
    await tester.pumpAndSettle();
    expect(find.text('onboarding page'), findsOneWidget);
  });

  testWidgets('submits via password field onFieldSubmitted', (tester) async {
    when(() => mockAuth.login(any(), any())).thenAnswer((_) async => true);
    when(() => mockAuth.dashboardRoute).thenReturn('/dashboard');

    await tester.pumpWidget(buildScreen());
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).first, 'a@b.com');
    await tester.enterText(find.byType(TextFormField).last, 'password');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    verify(() => mockAuth.login('a@b.com', 'password')).called(1);
  });

  testWidgets('validation blocks empty submit', (tester) async {
    await tester.pumpWidget(buildScreen());
    await tester.pump();

    await tester.tap(find.text('Masuk').last);
    await tester.pumpAndSettle();
    verifyNever(() => mockAuth.login(any(), any()));
    expect(find.text('Email wajib diisi'), findsOneWidget);
  });

  testWidgets('invalid email format validation', (tester) async {
    await tester.pumpWidget(buildScreen());
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).first, 'not-an-email');
    await tester.enterText(find.byType(TextFormField).last, 'password123');
    await tester.tap(find.text('Masuk').last);
    await tester.pumpAndSettle();

    expect(find.text('Format email tidak valid'), findsOneWidget);
    verifyNever(() => mockAuth.login(any(), any()));
  });

  testWidgets('empty password validation', (tester) async {
    await tester.pumpWidget(buildScreen());
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).first, 'a@b.com');
    await tester.tap(find.text('Masuk').last);
    await tester.pumpAndSettle();

    expect(find.text('Password wajib diisi'), findsOneWidget);
  });

  testWidgets('short password validation', (tester) async {
    await tester.pumpWidget(buildScreen());
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).first, 'a@b.com');
    await tester.enterText(find.byType(TextFormField).last, '12345');
    await tester.tap(find.text('Masuk').last);
    await tester.pumpAndSettle();

    expect(find.text('Password minimal 6 karakter'), findsOneWidget);
    verifyNever(() => mockAuth.login(any(), any()));
  });

  testWidgets('failed login stays on screen', (tester) async {
    when(() => mockAuth.login(any(), any())).thenAnswer((_) async => false);
    when(() => mockAuth.error).thenReturn('Email atau password salah');

    await tester.pumpWidget(buildScreen());
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).first, 'a@b.com');
    await tester.enterText(find.byType(TextFormField).last, 'password');
    await tester.tap(find.text('Masuk').last);
    await tester.pumpAndSettle();

    expect(find.text('dash'), findsNothing);
    expect(find.text('SELAMAT DATANG KEMBALI'), findsOneWidget);
  });

  testWidgets('loading disables submit button', (tester) async {
    when(() => mockAuth.isLoading).thenReturn(true);
    await tester.pumpWidget(buildScreen());
    await tester.pump();

    // isLoading replaces label with spinner
    expect(find.byType(CircularProgressIndicator), findsWidgets);
    verifyNever(() => mockAuth.login(any(), any()));
  });
}
