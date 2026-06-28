import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/auth_provider.dart';
import '../core/models.dart';
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
import '../features/superadmin/superadmin_dashboard_screen.dart';
import '../features/superadmin/superadmin_resource_screen.dart';
import '../features/superadmin/superadmin_organizations_screen.dart';
import '../features/superadmin/superadmin_users_screen.dart';
import '../features/superadmin/superadmin_regions_screen.dart';
import '../features/superadmin/superadmin_system_screen.dart';
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
        builder: (context, state) => const _SplashScreen(),
      ),
      GoRoute(
        path: '/forgot-password',
        builder: (context, state) => const ForgotPasswordScreen(),
      ),
      GoRoute(
        path: '/about',
        builder: (context, state) => const AboutScreen(),
      ),
      GoRoute(
        path: '/terms',
        builder: (context, state) => const TermsScreen(),
      ),
      GoRoute(
        path: '/privacy',
        builder: (context, state) => const PrivacyScreen(),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (context, state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => _AppScaffold(child: child),
        routes: [
          GoRoute(
            path: '/dashboard',
            builder: (context, state) => const UserDashboardScreen(),
          ),
          GoRoute(
            path: '/pengepul/dashboard',
            builder: (context, state) => const PengepulDashboardScreen(),
          ),
          GoRoute(
            path: '/scan',
            builder: (context, state) => const ScanScreen(),
          ),
          GoRoute(
            path: '/wallet',
            builder: (context, state) => const WalletScreen(),
          ),
          GoRoute(
            path: '/map',
            builder: (context, state) => const MapScreen(),
          ),
          GoRoute(
            path: '/campaigns',
            builder: (context, state) => const CampaignsScreen(),
          ),
          GoRoute(
            path: '/pickup',
            builder: (context, state) => const PickupScreen(),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) => const ProfileScreen(),
          ),
          GoRoute(
            path: '/pengepul/area',
            builder: (context, state) => const AreaMapScreen(),
          ),
          // Admin routes
          GoRoute(
            path: '/admin',
            builder: (context, state) => const AdminDashboardScreen(),
          ),
          GoRoute(
            path: '/admin/machines',
            builder: (context, state) => const AdminMachinesScreen(),
          ),
          GoRoute(
            path: '/admin/machines/:id/detail',
            builder: (context, state) {
              final id = state.pathParameters['id']!;
              return AdminMachineDetailScreen(machineId: id);
            },
          ),
          GoRoute(
            path: '/admin/pickups',
            builder: (context, state) => const AdminPickupsScreen(),
          ),
          GoRoute(
            path: '/admin/campaigns',
            builder: (context, state) => const AdminCampaignsScreen(),
          ),
          GoRoute(
            path: '/admin/waste-types',
            builder: (context, state) => const AdminWasteTypesScreen(),
          ),
          GoRoute(
            path: '/admin/partners',
            builder: (context, state) => const AdminPartnersScreen(),
          ),
          GoRoute(
            path: '/admin/trips',
            builder: (context, state) => const AdminTripsScreen(),
          ),
          GoRoute(
            path: '/admin/reports',
            builder: (context, state) => const AdminReportsScreen(),
          ),
          GoRoute(path: '/superadmin', builder: (context, state) => const SuperadminDashboardScreen()),
          GoRoute(path: '/superadmin/organizations', builder: (context, state) => const SuperadminOrganizationsScreen()),
          GoRoute(path: '/superadmin/machines', builder: (context, state) => const AdminMachinesScreen()),
          GoRoute(
            path: '/superadmin/machines/:id/detail',
            builder: (context, state) {
              final id = state.pathParameters['id']!;
              return AdminMachineDetailScreen(machineId: id);
            },
          ),
          GoRoute(path: '/superadmin/users', builder: (context, state) => const SuperadminUsersScreen()),
          GoRoute(path: '/superadmin/partnerships', builder: (context, state) => const SuperadminResourceScreen(title: 'Kemitraan', endpoint: '/api/partnerships', rootKey: 'partnerships', primaryFields: ['status', 'contactName'], secondaryFields: ['organization', 'collector'], action: SuperadminResourceAction.partnership)),
          GoRoute(path: '/superadmin/redemptions', builder: (context, state) => const SuperadminResourceScreen(title: 'Redemption', endpoint: '/api/redemptions?queue=1', rootKey: 'redemptions', primaryFields: ['amount', 'status'], secondaryFields: ['provider', 'user'], action: SuperadminResourceAction.redemption)),
          GoRoute(path: '/superadmin/regions', builder: (context, state) => const SuperadminRegionsScreen()),
          GoRoute(path: '/superadmin/waste-types', builder: (context, state) => const AdminWasteTypesScreen()),
          GoRoute(path: '/superadmin/security', builder: (context, state) => const SuperadminSystemScreen(title: 'Log Keamanan', mode: SuperadminSystemMode.security)),
          GoRoute(path: '/superadmin/config', builder: (context, state) => const SuperadminSystemScreen(title: 'Konfigurasi Global', mode: SuperadminSystemMode.config)),
          GoRoute(path: '/superadmin/audit', builder: (context, state) => const SuperadminSystemScreen(title: 'Audit Log', mode: SuperadminSystemMode.audit)),
          GoRoute(path: '/superadmin/reports', builder: (context, state) => const AdminReportsScreen()),
        ],
      ),

      GoRoute(
        path: '/wallet/redemption',
        builder: (context, state) => const RedemptionScreen(),
      ),
      GoRoute(
        path: '/wallet/redemption/create',
        builder: (context, state) => const PayoutAccountForm(),
      ),
      GoRoute(
        path: '/wallet/add-account',
        builder: (context, state) => const PayoutAccountForm(),
      ),
      GoRoute(
        path: '/trash-bags',
        builder: (context, state) => const TrashBagScreen(),
      ),
      GoRoute(
        path: '/machine/:code/detail',
        builder: (context, state) {
          final code = state.pathParameters['code']!;
          return MachineDetailScreen(machineCode: code);
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
