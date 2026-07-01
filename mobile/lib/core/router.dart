import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/auth_provider.dart';
import '../core/models.dart';
import '../core/page_transitions.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/dashboard/user_dashboard_screen.dart';
import '../features/dashboard/pengepul_dashboard_screen.dart';
import '../features/scan/scan_screen.dart';
import '../features/wallet/wallet_screen.dart';
import '../features/wallet/redemption_screen.dart';
import '../features/wallet/payout_account_form.dart';
import '../features/map/map_screen.dart';
import '../features/campaigns/campaigns_screen.dart';
import '../features/pickup/pickup_screen.dart';
// Admin travel/compliance screens are not yet linked from the admin shell;
// imports removed together with their GoRoute entries below to keep the
// release build green. Restore the routes once the screens land.
import '../features/profile/profile_screen.dart';
import '../features/trash_bag/trash_bag_screen.dart';
import '../features/machine/machine_detail_screen.dart';
import '../features/pengepul/area_map_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/legal/terms_screen.dart';
import '../features/legal/privacy_screen.dart';
import '../features/about/about_screen.dart';
import '../features/auth/forgot_password_screen.dart';
import '../features/admin/admin_dashboard_screen.dart';
import '../features/admin/admin_machines_screen.dart';
import '../features/admin/admin_machine_detail_screen.dart';
import '../features/admin/admin_pickups_screen.dart';
import '../features/admin/admin_campaigns_screen.dart';
import '../features/admin/admin_waste_types_screen.dart';
import '../features/admin/admin_partners_screen.dart';
import '../features/admin/admin_trips_screen.dart';
import '../features/admin/admin_reports_screen.dart';
import '../features/admin/admin_shell.dart';
import '../features/superadmin/superadmin_partnerships_screen.dart';
import '../features/superadmin/superadmin_redemptions_screen.dart';
import '../features/superadmin/superadmin_dashboard_screen.dart';
import '../features/superadmin/superadmin_organizations_screen.dart';
import '../features/superadmin/superadmin_users_screen.dart';
import '../features/superadmin/superadmin_regions_screen.dart';
import '../features/superadmin/superadmin_system_screen.dart';
import '../features/superadmin/superadmin_waste_types_screen.dart';
import '../shared/widgets/reloop_logo.dart';
import '../services/notification_service.dart';
import '../services/analytics_service.dart';
import '../theme/colors.dart';

class AppRouter {
  final AuthProvider authProvider;
  final NotificationService _notifService;
  final AnalyticsService _analytics;

  AppRouter(this.authProvider, this._notifService, {AnalyticsService? analytics})
      : _analytics = analytics ?? AnalyticsService() {
    _notifService.onNotificationTap = _handleNotificationTap;
  }

  void _handleNotificationTap(String route, Map<String, String>? params) {
    final currentRoute = router.routerDelegate.currentConfiguration.uri.path;
    if (currentRoute == route) return;
    if (params != null && params.isNotEmpty) {
      final uri = Uri(path: route, queryParameters: params);
      router.go(uri.toString());
    } else {
      router.go(route);
    }
  }

  void _trackScreenView(String? location) {
    if (location == null) return;
    final name = _screenNameMap[location] ?? location;
    _analytics.logScreenView(screenName: name);
  }

  static const _screenNameMap = {
    '/login': 'Login',
    '/register': 'Register',
    '/dashboard': 'Dashboard',
    '/pengepul/dashboard': 'Dashboard Pengepul',
    '/scan': 'Scan',
    '/wallet': 'Wallet',
    '/wallet/redemption': 'Redemption',
    '/map': 'Map',
    '/campaigns': 'Campaigns',
    '/pickup': 'Pickup',
    '/profile': 'Profile',
    '/trash-bags': 'Trash Bag',
  };

  late final router = GoRouter(
    refreshListenable: authProvider,
    initialLocation: '/splash',
    routes: [
      GoRoute(
        path: '/splash',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const _SplashScreen(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/forgot-password',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const ForgotPasswordScreen(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/about',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const AboutScreen(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/terms',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const TermsScreen(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/privacy',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const PrivacyScreen(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/onboarding',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const OnboardingScreen(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/login',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const LoginScreen(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/register',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const RegisterScreen(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      ShellRoute(
        builder: (context, state, child) => _AppScaffold(child: child),
        routes: [
          GoRoute(
            path: '/dashboard',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const UserDashboardScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/pengepul/dashboard',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const PengepulDashboardScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/scan',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const ScanScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/wallet',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const WalletScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/map',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const MapScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/campaigns',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const CampaignsScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/pickup',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const PickupScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/profile',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const ProfileScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/pengepul/area',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AreaMapScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          // Admin routes
          GoRoute(
            path: '/admin',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AdminDashboardScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/admin/machines',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AdminMachinesScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/admin/machines/:id/detail',
            pageBuilder: (context, state) {
              final id = state.pathParameters['id']!;
              return buildPage(
                key: state.pageKey,
                child: AdminMachineDetailScreen(machineId: id),
                style: styleForPath(state.matchedLocation),
              );
            },
          ),
          GoRoute(
            path: '/admin/pickups',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AdminPickupsScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/admin/campaigns',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AdminCampaignsScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/admin/waste-types',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AdminWasteTypesScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/admin/partners',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AdminPartnersScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/admin/trips',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AdminTripsScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/admin/reports',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AdminReportsScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const SuperadminDashboardScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/organizations',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const SuperadminOrganizationsScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/machines',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AdminMachinesScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/machines/:id/detail',
            pageBuilder: (context, state) {
              final id = state.pathParameters['id']!;
              return buildPage(
                key: state.pageKey,
                child: AdminMachineDetailScreen(machineId: id),
                style: styleForPath(state.matchedLocation),
              );
            },
          ),
          GoRoute(
            path: '/superadmin/users',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const SuperadminUsersScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/partnerships',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const SuperadminPartnershipsScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/redemptions',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const SuperadminRedemptionsScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/regions',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const SuperadminRegionsScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/waste-types',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const SuperadminWasteTypesScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/security',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const SuperadminSystemScreen(
                title: 'Log Keamanan',
                mode: SuperadminSystemMode.security,
              ),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/config',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const SuperadminSystemScreen(
                title: 'Konfigurasi Global',
                mode: SuperadminSystemMode.config,
              ),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/audit',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const SuperadminSystemScreen(
                title: 'Audit Log',
                mode: SuperadminSystemMode.audit,
              ),
              style: styleForPath(state.matchedLocation),
            ),
          ),
          GoRoute(
            path: '/superadmin/reports',
            pageBuilder: (context, state) => buildPage(
              key: state.pageKey,
              child: const AdminReportsScreen(),
              style: styleForPath(state.matchedLocation),
            ),
          ),
        ],
      ),

      GoRoute(
        path: '/wallet/redemption',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const RedemptionScreen(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/wallet/redemption/create',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const PayoutAccountForm(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/wallet/add-account',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const PayoutAccountForm(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/trash-bags',
        pageBuilder: (context, state) => buildPage(
          key: state.pageKey,
          child: const TrashBagScreen(),
          style: styleForPath(state.matchedLocation),
        ),
      ),
      GoRoute(
        path: '/machine/:code/detail',
        pageBuilder: (context, state) {
          final code = state.pathParameters['code']!;
          return buildPage(
            key: state.pageKey,
            child: MachineDetailScreen(machineCode: code),
            style: styleForPath(state.matchedLocation),
          );
        },
      ),
    ],
    redirect: (context, state) {
      final location = state.matchedLocation;
      _trackScreenView(location);
      final isAuthenticated = authProvider.isAuthenticated;
      final isAuthRoute = location == '/login' ||
          location == '/register' ||
          location == '/onboarding' ||
          location == '/forgot-password';
      final isSplash = location == '/splash';

      if (isSplash) return null;
      if (!isAuthenticated && !isAuthRoute) {
        return '/login?redirect=${Uri.encodeComponent(location)}';
      }
      if (isAuthenticated && isAuthRoute) {
        final redirect = state.uri.queryParameters['redirect'];
        if (redirect != null) return redirect;
        return authProvider.dashboardRoute;
      }
      return null;
    },
  );
}

class _SplashScreen extends StatefulWidget {
  const _SplashScreen();

  @override
  State<_SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<_SplashScreen> {
  @override
  void initState() {
    super.initState();
    _checkAuth();
  }

  Future<void> _checkAuth() async {
    final auth = context.read<AuthProvider>();
    await auth.checkSession();

    final storage = const FlutterSecureStorage();
    final onboardingDone = await storage.read(key: 'onboarding_completed');

    if (!mounted) return;
    if (onboardingDone != 'true') {
      context.go('/onboarding');
    } else if (auth.isAuthenticated) {
      context.go(auth.dashboardRoute);
    } else {
      context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.reloopBackground,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ReLoopLogo(compact: true, height: 64),
            const SizedBox(height: 24),
            const CircularProgressIndicator(color: ReLoopColors.brand500),
          ],
        ),
      ),
    );
  }
}

class _AppScaffold extends StatelessWidget {
  const _AppScaffold({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final location = GoRouterState.of(context).matchedLocation;
    final user = auth.user;
    final isCollector = user?.role == AppRole.PENGEPUL;
    final isAdmin = user?.role == AppRole.ADMIN || user?.role == AppRole.SUPERADMIN;

    if (isAdmin) {
      if (location == '/profile') return AdminShell(title: 'Profil', child: child);
      if (location == '/scan') return AdminShell(title: 'Scan Trash Bag', child: child);
      return child;
    }

    final items = isCollector ? _pengepulNavItems : _userNavItems;
    var currentIndex = items.indexWhere((item) => location.startsWith(item['path'] as String));
    if (currentIndex < 0) currentIndex = 0;

    return Scaffold(
      body: SafeArea(bottom: false, child: child),
      bottomNavigationBar: _CustomBottomNavBar(
        selectedIndex: currentIndex,
        items: items,
        onTap: (index) => context.go(items[index]['path'] as String),
      ),
    );
  }
}

class _CustomBottomNavBar extends StatelessWidget {
  const _CustomBottomNavBar({required this.selectedIndex, required this.items, required this.onTap});
  final int selectedIndex;
  final List<Map<String, dynamic>> items;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, bottomInset + 4),
      child: Container(
        height: 60,
        decoration: BoxDecoration(
          color: context.reloopSurfaceRaised.withValues(alpha: .98),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: context.reloopBorder),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: context.isDarkMode ? .38 : .08),
              blurRadius: context.isDarkMode ? 22 : 16,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Row(
          children: List.generate(items.length, (index) {
            final item = items[index];
            final selected = selectedIndex == index;
            final primary = item['path'] == '/scan';
            final color = selected ? context.reloopBrandText : context.reloopMuted;
            final icon = (selected ? item['selectedIcon'] : item['icon']) as IconData;
            return Expanded(
              child: InkWell(
                borderRadius: BorderRadius.circular(18),
                onTap: () => onTap(index),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      width: primary ? 44 : (selected ? 42 : 36),
                      height: primary ? 39 : 34,
                      decoration: BoxDecoration(
                        color: primary ? ReLoopColors.brand600 : selected ? context.reloopBrandSoft : Colors.transparent,
                        borderRadius: BorderRadius.circular(primary ? 13 : 11),
                        boxShadow: primary ? const [BoxShadow(color: Color(0x28249A4D), blurRadius: 12, offset: Offset(0, 4))] : null,
                      ),
                      child: Icon(icon, size: primary ? 24 : 22, color: primary ? Colors.white : color),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      item['label'] as String,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 9.5, fontWeight: selected ? FontWeight.w700 : FontWeight.w500, color: color),
                    ),
                  ],
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}

const _userNavItems = [
  {'path': '/dashboard', 'icon': Icons.dashboard_outlined, 'selectedIcon': Icons.dashboard_rounded, 'label': 'Beranda'},
  {'path': '/map', 'icon': Icons.map_outlined, 'selectedIcon': Icons.map, 'label': 'Peta'},
  {'path': '/scan', 'icon': Icons.qr_code_scanner_outlined, 'selectedIcon': Icons.qr_code_scanner, 'label': 'Scan'},
  {'path': '/wallet', 'icon': Icons.account_balance_wallet_outlined, 'selectedIcon': Icons.account_balance_wallet, 'label': 'Dompet'},
  {'path': '/profile', 'icon': Icons.person_outline_rounded, 'selectedIcon': Icons.person_rounded, 'label': 'Profil'},
];

const _pengepulNavItems = [
  {'path': '/pengepul/dashboard', 'icon': Icons.dashboard_outlined, 'selectedIcon': Icons.dashboard_rounded, 'label': 'Dashboard'},
  {'path': '/pickup', 'icon': Icons.local_shipping_outlined, 'selectedIcon': Icons.local_shipping, 'label': 'Tugas'},
  {'path': '/map', 'icon': Icons.map_outlined, 'selectedIcon': Icons.map, 'label': 'Peta'},
  {'path': '/pengepul/area', 'icon': Icons.location_on_outlined, 'selectedIcon': Icons.location_on, 'label': 'Area'},
  {'path': '/profile', 'icon': Icons.person_outline_rounded, 'selectedIcon': Icons.person_rounded, 'label': 'Profil'},
];
