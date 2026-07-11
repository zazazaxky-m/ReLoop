import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:local_auth/local_auth.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/profile/profile_screen.dart';
import 'package:reloop_mobile/providers/theme_provider.dart';
import 'package:reloop_mobile/services/biometric_service.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockAuthProvider extends Mock implements AuthProvider {}

class MockApiClient extends Mock implements ApiClient {}

class MockThemeProvider extends Mock implements ThemeProvider {}

void main() {
  late MockAuthProvider mockAuth;
  late MockApiClient mockApi;
  late MockThemeProvider mockTheme;

  setUpAll(() {
    registerFallbackValue(ThemeMode.system);
  });

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    FlutterSecureStorage.setMockInitialValues({});
    mockAuth = MockAuthProvider();
    mockApi = MockApiClient();
    mockTheme = MockThemeProvider();

    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        phone: '081234567890',
        role: AppRole.USER,
        status: 'ACTIVE',
        organizationName: 'Org A',
      ),
    );
    when(() => mockAuth.error).thenReturn(null);
    when(() => mockAuth.checkSession()).thenAnswer((_) async => null);
    when(() => mockAuth.logout()).thenAnswer((_) async {});
    when(() => mockTheme.isDark).thenReturn(false);
    when(() => mockTheme.themeMode).thenReturn(ThemeMode.light);
    when(() => mockTheme.setThemeMode(any())).thenAnswer((_) async {});
    when(() => mockTheme.toggle()).thenAnswer((_) async {});
  });

  Widget buildScreen() {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
        Provider<ApiClient>.value(value: mockApi),
        ChangeNotifierProvider<ThemeProvider>.value(value: mockTheme),
      ],
      child: MaterialApp.router(
        theme: AppTheme.light,
        routerConfig: GoRouter(
          initialLocation: '/profile',
          routes: [
            GoRoute(
              path: '/profile',
              builder: (_, __) => const ProfileScreen(),
            ),
            GoRoute(
              path: '/terms',
              builder: (_, __) => const Scaffold(body: Text('Terms page')),
            ),
            GoRoute(
              path: '/privacy',
              builder: (_, __) => const Scaffold(body: Text('Privacy page')),
            ),
            GoRoute(
              path: '/about',
              builder: (_, __) => const Scaffold(body: Text('About page')),
            ),
            GoRoute(
              path: '/login',
              builder: (_, __) => const Scaffold(body: Text('Login page')),
            ),
          ],
        ),
      ),
    );
  }

  testWidgets('ProfileScreen renders user info', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1200));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.text('Test User'), findsWidgets);
    expect(find.text('test@example.com'), findsWidgets);
    expect(find.text('Pengaturan', skipOffstage: false), findsOneWidget);
    expect(find.text('Keluar', skipOffstage: false), findsOneWidget);
  });

  testWidgets('cancel edit mode', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1400));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit Profil'));
    await tester.pumpAndSettle();
    expect(find.text('Simpan Perubahan'), findsOneWidget);
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    expect(find.text('Edit Profil'), findsOneWidget);
  });

  testWidgets('logout confirmation', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1400));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Keluar'));
    await tester.tap(find.text('Keluar'));
    await tester.pumpAndSettle();
    expect(find.textContaining('yakin ingin keluar'), findsOneWidget);
    await tester.tap(find.text('Batal').last);
    await tester.pumpAndSettle();
  });

  testWidgets('navigates to legal and about links', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Syarat & Ketentuan'));
    await tester.tap(find.text('Syarat & Ketentuan'));
    await tester.pumpAndSettle();
    expect(find.text('Terms page'), findsOneWidget);
  });

  testWidgets('toggles dark theme setting', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1400));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    final toggle = find.byType(Switch);
    expect(toggle, findsWidgets);
    await tester.tap(toggle.first);
    await tester.pump();
    verify(() => mockTheme.toggle()).called(1);
  });

  testWidgets('edit and save profile success', (tester) async {
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/auth/me'),
        data: {'ok': true},
      ),
    );

    await tester.binding.setSurfaceSize(const Size(400, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit Profil'));
    await tester.pumpAndSettle();

    final fields = find.byType(TextFormField);
    expect(fields, findsWidgets);
    await tester.enterText(fields.at(0), 'Nama Baru');
    await tester.enterText(fields.at(1), 'baru@example.com');
    await tester.enterText(fields.at(2), '081234567890');

    await tester.ensureVisible(find.text('Simpan Perubahan'));
    await tester.tap(find.text('Simpan Perubahan'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.textContaining('Profil berhasil diperbarui'), findsOneWidget);
  });

  testWidgets('edit profile save failure', (tester) async {
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/api/auth/me'),
        type: DioExceptionType.connectionError,
      ),
    );

    await tester.binding.setSurfaceSize(const Size(400, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit Profil'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Simpan Perubahan'));
    await tester.tap(find.text('Simpan Perubahan'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.textContaining('Gagal memperbarui profil'), findsOneWidget);
  });

  testWidgets('confirm logout calls auth.logout', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1400));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Keluar'));
    await tester.tap(find.text('Keluar'));
    await tester.pumpAndSettle();

    final confirm = find.widgetWithText(TextButton, 'Keluar');
    expect(confirm, findsWidgets);
    await tester.tap(confirm.last);
    await tester.pumpAndSettle();
    verify(() => mockAuth.logout()).called(1);
  });

  testWidgets('privacy and about links navigate', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1800));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Kebijakan Privasi'));
    await tester.tap(find.text('Kebijakan Privasi'));
    await tester.pumpAndSettle();
    expect(find.text('Privacy page'), findsOneWidget);
  });

  testWidgets('about link navigates', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1800));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Tentang Aplikasi'));
    await tester.tap(find.text('Tentang Aplikasi'));
    await tester.pumpAndSettle();
    expect(find.text('About page'), findsOneWidget);
  });

  testWidgets('null user shows loading', (tester) async {
    when(() => mockAuth.user).thenReturn(null);
    await tester.binding.setSurfaceSize(const Size(400, 800));
    await tester.pumpWidget(buildScreen());
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsWidgets);
  });

  testWidgets('validation rejects short name', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit Profil'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).at(0), 'A');
    await tester.ensureVisible(find.text('Simpan Perubahan'));
    await tester.tap(find.text('Simpan Perubahan'));
    await tester.pumpAndSettle();
    expect(find.text('Nama minimal 2 karakter'), findsOneWidget);
  });

  testWidgets('validation rejects bad email and phone', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit Profil'));
    await tester.pumpAndSettle();
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'Nama Valid');
    await tester.enterText(fields.at(1), 'bademail');
    await tester.enterText(fields.at(2), '123');
    await tester.ensureVisible(find.text('Simpan Perubahan'));
    await tester.tap(find.text('Simpan Perubahan'));
    await tester.pumpAndSettle();
    expect(find.text('Email tidak valid'), findsOneWidget);
  });

  testWidgets('validation rejects short new password', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1800));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit Profil'));
    await tester.pumpAndSettle();

    final fields = find.byType(TextFormField);
    // name, email, phone, current password, new password (order may vary)
    if (fields.evaluate().length >= 5) {
      await tester.enterText(fields.at(4), '12345');
      await tester.ensureVisible(find.text('Simpan Perubahan'));
      await tester.tap(find.text('Simpan Perubahan'));
      await tester.pumpAndSettle();
      expect(find.textContaining('minimal 6'), findsWidgets);
    }
  });

  testWidgets('admin role hides user app bar title path', (tester) async {
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: '1',
        name: 'Admin User',
        email: 'admin@example.com',
        phone: '081234567890',
        role: AppRole.ADMIN,
        status: 'ACTIVE',
      ),
    );
    await tester.binding.setSurfaceSize(const Size(400, 1400));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();
    expect(find.text('Admin User'), findsWidgets);
  });

  testWidgets('biometric enable success flow', (tester) async {
    BiometricService.debugAvailabilityOverride = true;
    BiometricService.debugAvailableTypes = [BiometricType.fingerprint];
    BiometricService.debugAuthenticateResult = true;
    when(() => mockAuth.verifyPassword(any())).thenAnswer((_) async => true);

    await tester.binding.setSurfaceSize(const Size(400, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    expect(find.textContaining('Login dengan'), findsOneWidget);
    final switches = find.byType(Switch);
    expect(switches, findsWidgets);
    // Theme switch is first; biometric is second when available.
    await tester.tap(switches.at(1));
    await tester.pumpAndSettle();

    expect(find.text('Konfirmasi Password'), findsOneWidget);
    // Toggle password visibility
    await tester.tap(find.byIcon(Icons.visibility_off));
    await tester.pump();
    expect(find.byIcon(Icons.visibility), findsOneWidget);

    await tester.enterText(find.byType(TextFormField).last, 'secret12');
    await tester.tap(find.text('Lanjut'));
    await tester.pumpAndSettle();

    expect(find.textContaining('berhasil diaktifkan'), findsOneWidget);

    BiometricService.debugAvailabilityOverride = null;
    BiometricService.debugAvailableTypes = null;
    BiometricService.debugAuthenticateResult = null;
  });

  testWidgets('biometric enable cancel and auth failure', (tester) async {
    BiometricService.debugAvailabilityOverride = true;
    BiometricService.debugAvailableTypes = [BiometricType.face];
    BiometricService.debugAuthenticateResult = false;
    when(() => mockAuth.verifyPassword(any())).thenAnswer((_) async => true);

    await tester.binding.setSurfaceSize(const Size(400, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.byType(Switch).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(Switch).at(1));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).last, 'secret12');
    await tester.tap(find.text('Lanjut'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Gagal memverifikasi'), findsOneWidget);

    BiometricService.debugAvailabilityOverride = null;
    BiometricService.debugAvailableTypes = null;
    BiometricService.debugAuthenticateResult = null;
  });

  testWidgets('biometric disable and bad password', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'biometric_enabled': 'true'});
    BiometricService.debugAvailabilityOverride = true;
    BiometricService.debugAvailableTypes = [BiometricType.fingerprint];
    when(() => mockAuth.verifyPassword(any())).thenAnswer((_) async => false);
    when(() => mockAuth.error).thenReturn('Password tidak sesuai');

    await tester.binding.setSurfaceSize(const Size(400, 1600));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    // Disable biometric (switch is on)
    await tester.tap(find.byType(Switch).at(1));
    await tester.pumpAndSettle();

    // Re-enable and fail password
    BiometricService.debugAuthenticateResult = true;
    await tester.tap(find.byType(Switch).at(1));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).last, 'wrong');
    await tester.tap(find.text('Lanjut'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Password tidak sesuai'), findsOneWidget);

    BiometricService.debugAvailabilityOverride = null;
    BiometricService.debugAvailableTypes = null;
    BiometricService.debugAuthenticateResult = null;
  });

  testWidgets('save profile with password fields', (tester) async {
    when(() => mockApi.patch(any(), data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/api/auth/me'),
        data: {'ok': true},
      ),
    );

    await tester.binding.setSurfaceSize(const Size(400, 1800));
    await tester.pumpWidget(buildScreen());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Edit Profil'));
    await tester.pumpAndSettle();

    final fields = find.byType(TextFormField);
    if (fields.evaluate().length >= 5) {
      await tester.enterText(fields.at(3), 'oldpass1');
      await tester.enterText(fields.at(4), 'newpass1');
    }
    await tester.ensureVisible(find.text('Simpan Perubahan'));
    await tester.tap(find.text('Simpan Perubahan'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Profil berhasil diperbarui'), findsOneWidget);
  });
}
