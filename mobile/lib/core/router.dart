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
import '../features/trash_bag/trash_bag_form.dart';
import '../features/trash_bag/trash_bag_history.dart';
import '../features/machine/machine_detail_screen.dart';
import '../features/pengepul/area_map_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/legal/terms_screen.dart';
import '../features/legal/privacy_screen.dart';
import '../features/about/about_screen.dart';
import '../features/auth/forgot_password_screen.dart';
import '../features/admin/admin_dashboard_screen.dart';
import '../features/admin/admin_machines_screen.dart';
import '../features/admin/admin_pickups_screen.dart';
import '../features/admin/admin_campaigns_screen.dart';
import '../features/admin/admin_waste_types_screen.dart';
import '../features/admin/admin_partners_screen.dart';
import '../features/admin/admin_trips_screen.dart';
import '../features/admin/admin_reports_screen.dart';
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
    '/trash-bags/create': 'Trash Bag Form',
    '/trash-bags/history': 'Trash Bag History',
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
        ],
      ),
      GoRoute(
        path: '/campaigns',
        builder: (context, state) => const CampaignsScreen(),
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
        path: '/trash-bags/create',
        builder: (context, state) => const TrashBagForm(),
      ),
      GoRoute(
        path: '/trash-bags/history',
        builder: (context, state) => const TrashBagHistory(),
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
      backgroundColor: ReLoopColors.background,
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
  final Widget child;

  const _AppScaffold({required this.child});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final location = GoRouterState.of(context).matchedLocation;
    final user = auth.user;

    final isCollector = user?.role == AppRole.PENGEPUL;
    final isAdmin = user?.role == AppRole.ADMIN ||
        user?.role == AppRole.SUPERADMIN;

    if (isAdmin) {
      return child;
    }

    final items = isCollector ? _pengepulNavItems : _userNavItems;
    final pageTitle = isCollector ? _pengepulPageTitles[location] : _userPageTitles[location];
    int currentIndex = items.indexWhere(
      (item) => location.startsWith(item['path'] as String),
    );
    if (currentIndex < 0) currentIndex = 0;

    return Scaffold(
      body: Column(
        children: [
          _AppHeader(
            user: user,
            pageTitle: pageTitle ?? 'ReLoop',
            onLogout: () => auth.logout(),
          ),
          Expanded(child: child),
        ],
      ),
      bottomNavigationBar: _CustomBottomNavBar(
        selectedIndex: currentIndex,
        items: items,
        onTap: (index) {
          final path = items[index]['path'] as String;
          context.go(path);
        },
      ),
    );
  }
}

class _CustomBottomNavBar extends StatelessWidget {
  final int selectedIndex;
  final List<Map<String, dynamic>> items;
  final ValueChanged<int> onTap;

  const _CustomBottomNavBar({
    required this.selectedIndex,
    required this.items,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: ReLoopColors.surface,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            offset: const Offset(0, -4),
            blurRadius: 8,
            spreadRadius: 0,
          ),
        ],
        border: const Border(
          top: BorderSide(color: ReLoopColors.border, width: 0.5),
        ),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 60,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: List.generate(items.length, (index) {
              final item = items[index];
              final isSelected = selectedIndex == index;
              final color = isSelected ? ReLoopColors.brand700 : ReLoopColors.muted;
              final iconData = (isSelected ? item['selectedIcon'] : item['icon']) as IconData;
              final label = item['label'] as String;

              return Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => onTap(index),
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      if (isSelected)
                        Positioned(
                          top: 0,
                          left: 0,
                          right: 0,
                          child: Align(
                            alignment: Alignment.topCenter,
                            child: Container(
                              width: 32,
                              height: 2,
                              decoration: const BoxDecoration(
                                color: ReLoopColors.brand500,
                                borderRadius: BorderRadius.only(
                                  bottomLeft: Radius.circular(4),
                                  bottomRight: Radius.circular(4),
                                ),
                              ),
                            ),
                          ),
                        ),
                      Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const SizedBox(height: 4),
                            Container(
                              width: 32,
                              height: 32,
                              decoration: BoxDecoration(
                                color: isSelected ? ReLoopColors.brand50 : Colors.transparent,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Icon(
                                iconData,
                                color: color,
                                size: 18,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              label,
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                                color: color,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }
}

class _AppHeader extends StatelessWidget {
  final CurrentUser? user;
  final String pageTitle;
  final VoidCallback onLogout;

  const _AppHeader({
    required this.user,
    required this.pageTitle,
    required this.onLogout,
  });

  @override
  Widget build(BuildContext context) {
    if (user == null) return const SizedBox.shrink();

    return SafeArea(
      bottom: false,
      child: Container(
        height: 56,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: const BoxDecoration(
          color: ReLoopColors.surface,
          border: Border(bottom: BorderSide(color: ReLoopColors.border)),
        ),
        child: Row(
          children: [
            const ReLoopLogo(compact: true, height: 28),
            const SizedBox(width: 10),
            Container(
              width: 1,
              height: 24,
              color: ReLoopColors.border,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    pageTitle,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: ReLoopColors.foreground,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    user!.role.label,
                    style: const TextStyle(
                      fontSize: 10,
                      color: ReLoopColors.mutedSoft,
                    ),
                  ),
                ],
              ),
            ),
            IconButton(
              icon: const Icon(Icons.logout, size: 20),
              color: ReLoopColors.muted,
              tooltip: 'Keluar',
              onPressed: onLogout,
            ),
          ],
        ),
      ),
    );
  }
}

const _userNavItems = [
  {
    'path': '/dashboard',
    'icon': Icons.dashboard_outlined,
    'selectedIcon': Icons.dashboard_rounded,
    'label': 'Beranda',
  },
  {
    'path': '/scan',
    'icon': Icons.qr_code_scanner_outlined,
    'selectedIcon': Icons.qr_code_scanner,
    'label': 'Scan',
  },
  {
    'path': '/map',
    'icon': Icons.map_outlined,
    'selectedIcon': Icons.map,
    'label': 'Peta',
  },
  {
    'path': '/wallet',
    'icon': Icons.account_balance_wallet_outlined,
    'selectedIcon': Icons.account_balance_wallet,
    'label': 'Dompet',
  },
  {
    'path': '/campaigns',
    'icon': Icons.campaign_outlined,
    'selectedIcon': Icons.campaign,
    'label': 'Program',
  },
  {
    'path': '/profile',
    'icon': Icons.person_outline,
    'selectedIcon': Icons.person,
    'label': 'Profil',
  },
];

const _userPageTitles = {
  '/dashboard': 'Dashboard',
  '/scan': 'Scan Mesin',
  '/map': 'Peta',
  '/wallet': 'Dompet',
  '/profile': 'Profil',
  '/campaigns': 'Program',
  '/trash-bags': 'Kantong',
  '/pickup': 'Pickup',
};

const _pengepulNavItems = [
  {
    'path': '/pengepul/dashboard',
    'icon': Icons.dashboard_outlined,
    'selectedIcon': Icons.dashboard_rounded,
    'label': 'Dashboard',
  },
  {
    'path': '/pickup',
    'icon': Icons.local_shipping_outlined,
    'selectedIcon': Icons.local_shipping,
    'label': 'Tugas',
  },
  {
    'path': '/map',
    'icon': Icons.map_outlined,
    'selectedIcon': Icons.map,
    'label': 'Peta',
  },
  {
    'path': '/pengepul/area',
    'icon': Icons.location_on_outlined,
    'selectedIcon': Icons.location_on,
    'label': 'Area',
  },
  {
    'path': '/profile',
    'icon': Icons.person_outline,
    'selectedIcon': Icons.person,
    'label': 'Profil',
  },
];

const _pengepulPageTitles = {
  '/pengepul/dashboard': 'Dashboard Pengepul',
  '/pickup': 'Tugas Pickup',
  '/map': 'Peta Mesin',
  '/pengepul/area': 'Area Layanan',
  '/profile': 'Profil',
  '/wallet': 'Dompet',
};
