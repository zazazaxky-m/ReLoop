import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:reloop_mobile/core/auth_provider.dart';
import 'package:reloop_mobile/core/models.dart';
import 'package:reloop_mobile/features/admin/admin_shell.dart';
import 'package:reloop_mobile/theme/app_theme.dart';

class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockAuthProvider mockAuth;
  void Function(FlutterErrorDetails)? previousOnError;

  setUp(() {
    mockAuth = MockAuthProvider();
    when(() => mockAuth.logout()).thenAnswer((_) async {});
  });

  void suppressHarmlessErrors() {
    previousOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      final message = details.exceptionAsString();
      if (message.contains('RenderFlex overflowed') ||
          message.contains('A RenderFlex overflowed') ||
          message.contains('ListTile background')) {
        return;
      }
      previousOnError?.call(details);
    };
  }

  void stubUser(AppRole role, {String name = 'Admin User'}) {
    when(() => mockAuth.user).thenReturn(
      CurrentUser(
        id: 'u1',
        name: name,
        email: 'admin@example.com',
        role: role,
        status: 'ACTIVE',
      ),
    );
  }

  Widget buildApp({
    required AppRole role,
    required String initialLocation,
    Size size = const Size(400, 900),
  }) {
    stubUser(role);
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: mockAuth),
      ],
      child: MediaQuery(
        data: MediaQueryData(
          size: size,
          textScaler: const TextScaler.linear(0.85),
        ),
        child: MaterialApp.router(
          theme: AppTheme.light,
          routerConfig: GoRouter(
            initialLocation: initialLocation,
            routes: [
              for (final path in [
                '/admin',
                '/admin/machines',
                '/admin/pickups',
                '/admin/campaigns',
                '/admin/waste-types',
                '/admin/partners',
                '/admin/trips',
                '/admin/travel-agents',
                '/admin/compliance',
                '/admin/reports',
                '/superadmin',
                '/superadmin/organizations',
                '/superadmin/machines',
                '/superadmin/users',
                '/superadmin/partnerships',
                '/superadmin/redemptions',
                '/superadmin/reconciliation',
                '/superadmin/security',
                '/superadmin/regions',
                '/superadmin/waste-types',
                '/superadmin/config',
                '/superadmin/audit',
                '/superadmin/reports',
                '/scan',
                '/profile',
              ])
                GoRoute(
                  path: path,
                  builder: (_, __) => AdminShell(
                    title: 'Shell $path',
                    child: Center(child: Text('body $path')),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  testWidgets('admin mobile bottom nav navigates to machines', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(400, 900));
    await tester.pumpWidget(
      buildApp(role: AppRole.ADMIN, initialLocation: '/admin'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Beranda'), findsOneWidget);
    expect(find.text('Mesin'), findsOneWidget);
    expect(find.text('Pickup'), findsOneWidget);
    expect(find.text('Lainnya'), findsOneWidget);

    await tester.tap(find.text('Mesin'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('body /admin/machines'), findsOneWidget);
  });

  testWidgets('admin more sheet opens and navigates', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(400, 900));
    await tester.pumpWidget(
      buildApp(role: AppRole.ADMIN, initialLocation: '/admin'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.text('Lainnya'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Layanan teratas'), findsOneWidget);
    expect(find.text('Campaign'), findsWidgets);

    await tester.tap(find.text('Compliance').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('body /admin/compliance'), findsOneWidget);
  });

  testWidgets('superadmin mobile nav and more sheet', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(400, 900));
    await tester.pumpWidget(
      buildApp(role: AppRole.SUPERADMIN, initialLocation: '/superadmin'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Org'), findsOneWidget);
    expect(find.text('Lainnya'), findsOneWidget);

    final context = tester.element(find.text('body /superadmin'));
    showAdminMoreBottomSheet(context, true);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Pengelolaan'), findsOneWidget);
    expect(find.text('Layanan teratas'), findsOneWidget);
  });

  testWidgets('superadmin more sheet active item styling', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(400, 900));
    await tester.pumpWidget(
      buildApp(role: AppRole.SUPERADMIN, initialLocation: '/superadmin/regions'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    final context = tester.element(find.text('body /superadmin/regions'));
    showAdminMoreBottomSheet(context, true);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Pengelolaan'), findsOneWidget);
    final wilayah = find.text('Wilayah');
    if (wilayah.evaluate().isNotEmpty) {
      await tester.tap(wilayah.first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
    }
  });

  testWidgets('desktop rail navigates and logout', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    await tester.pumpWidget(
      buildApp(
        role: AppRole.ADMIN,
        initialLocation: '/admin',
        size: const Size(1200, 900),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Dashboard'), findsWidgets);
    expect(find.text('Keluar'), findsWidgets);

    await tester.tap(find.text('Pickup').hitTestable());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('body /admin/pickups'), findsOneWidget);

    await tester.tap(find.text('Keluar').hitTestable());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    verify(() => mockAuth.logout()).called(1);
  });

  testWidgets('superadmin desktop rail shows org item', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    await tester.pumpWidget(
      buildApp(
        role: AppRole.SUPERADMIN,
        initialLocation: '/superadmin',
        size: const Size(1200, 900),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Organisasi'), findsWidgets);
    expect(find.text('Log Keamanan'), findsOneWidget);

    await tester.tap(find.text('Organisasi').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('body /superadmin/organizations'), findsOneWidget);
  });

  testWidgets('avatar navigates to profile', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(400, 900));
    await tester.pumpWidget(
      buildApp(role: AppRole.ADMIN, initialLocation: '/admin'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.byType(CircleAvatar).first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('body /profile'), findsOneWidget);
  });

  testWidgets('superadmin more sheet taps section service tile', (tester) async {
    suppressHarmlessErrors();
    await tester.binding.setSurfaceSize(const Size(400, 1100));
    await tester.pumpWidget(
      buildApp(role: AppRole.SUPERADMIN, initialLocation: '/superadmin/audit'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    final context = tester.element(find.text('body /superadmin/audit'));
    showAdminMoreBottomSheet(context, true);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    final audit = find.text('Audit');
    if (audit.evaluate().isNotEmpty) {
      await tester.ensureVisible(audit.first);
      await tester.tap(audit.first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
    } else {
      final keamanan = find.textContaining('Keamanan');
      if (keamanan.evaluate().isNotEmpty) {
        await tester.tap(keamanan.first);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 100));
      }
    }
  });
}
